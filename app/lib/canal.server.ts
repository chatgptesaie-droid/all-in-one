import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const CONFIG_URL = "https://player.canalplus.com/one/configs/v2/13/mycanalafr/prod.json";
const TOKEN_URL = "https://pass-api-v2.canal-plus.com/provider/services/cpafr-tg/public/createToken";
const HODOR_URL = "https://hodor.canalplus.pro/api/v2/mycanal/page/463d215e5c2555ce704ede224689e9d8/107248.json";
const PROFILES_URL = "https://hodor.canalplus.pro/api/v2/mycanal/me/Profiles";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0";

export function parseCanalCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const simpleCookieBatches = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => ({ line: line.trim(), cookies: parseCookieLine(line) }))
    .filter(({ cookies }) => cookies.some((cookie) => cookie.name === "passId"));

  if (simpleCookieBatches.length) {
    return simpleCookieBatches.map(({ line, cookies }, index) => ({
      index: index + 1,
      cookies,
      rawLine: line.slice(0, 120),
    }));
  }

  const groups = content.replace(/\r/g, "").split(/\n\s*\n/).map((group) => group.trim()).filter(Boolean);
  for (const group of groups) {
    const cookies = group.split("\n").flatMap(parseCookieLine).filter((cookie) => /(?:^|\.)canalplus\.com$/i.test(cookie.domain.replace(/^\./, "")) || cookie.domain.toLowerCase().includes("canalplus.com"));
    if (cookies.length) batches.push({ index: batches.length + 1, cookies, rawLine: group.slice(0, 120) });
  }
  if (!batches.length) {
    const cookies = content.split("\n").flatMap(parseCookieLine);
    if (cookies.length) batches.push({ index: 1, cookies, rawLine: content.slice(0, 120) });
  }
  return batches;
}

function parseCookieLine(line: string) {
  const value = line.trim();
  if (!value || (value.startsWith("#") && !value.startsWith("#HttpOnly_"))) return [];

  const simpleCookie = value.match(/^passId=(.+)$/i);
  if (simpleCookie) {
    return [{
      domain: ".canalplus.com",
      flag: "TRUE",
      path: "/",
      secure: true,
      expiry: "0",
      name: "passId",
      value: simpleCookie[1].trim(),
    }];
  }

  const normalized = value.startsWith("#HttpOnly_") ? value.slice(10) : value;
  const fields = normalized.split("\t");
  if (fields.length < 7 || !fields[5]) return [];
  return [{ domain: fields[0], flag: fields[1], path: fields[2] || "/", secure: fields[3].toUpperCase() === "TRUE", expiry: fields[4], name: fields[5], value: fields.slice(6).join("\t") }];
}

function findAccountFields(value: unknown): Record<string, string | null> {
  const fields = ["Nom", "Offre", "N° de réabonnement", "Date d'échéance"];
  const result: Record<string, string | null> = Object.fromEntries(fields.map((field) => [field, null]));
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.title === "string" && fields.includes(record.title) && record.value != null) result[record.title] = String(record.value);
      Object.values(record).forEach(visit);
    }
  };
  visit(value);
  return result;
}

function findProfiles(value: unknown) {
  const profiles: string[] = [];
  const contents = value && typeof value === "object" && Array.isArray((value as any).contents) ? (value as any).contents : [];
  for (const item of contents) if (item?.type === "profile" && typeof item.ariaLabel === "string") profiles.push(item.ariaLabel.trim());
  return { profile_count: profiles.length, profiles };
}

async function jsonRequest(url: string, init: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function getExpiryStatus(value: string | null): "active" | "expired" | "unknown" {
  if (!value) return "unknown";
  const text = value.trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const expiry = match
    ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59)
    : new Date(text);
  if (Number.isNaN(expiry.getTime())) return "unknown";
  return expiry.getTime() < Date.now() ? "expired" : "active";
}

export async function validateCanalBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = { batchIndex: batch.index, netflixId: null, cookiesData: batch.cookies, netscapeFormat: formatBatchNetscape(batch.cookies) };
  const passCookie = batch.cookies.find((cookie) => cookie.name === "passId");
  if (!passCookie) return { ...base, isValid: false, message: "Cookie passId introuvable", accountInfo: {} };

  try {
    const commonHeaders = { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7", Referer: "https://www.canalplus.com/", Origin: "https://www.canalplus.com" };
    const config = await jsonRequest(CONFIG_URL, { headers: { ...commonHeaders, Accept: "application/json, text/plain, */*" } });
    const portailId = config.body?.pass?.portailId;
    if (!config.response.ok || typeof portailId !== "string") throw new Error(`Configuration HTTP ${config.response.status}`);

    const token = await jsonRequest(TOKEN_URL, { method: "POST", headers: { ...commonHeaders, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ portailId, media: "web", vect: "INTERNET", passIdType: "pass", noCache: "false", passId: passCookie.value }) });
    const passToken = token.body?.response?.passToken;
    if (!token.response.ok || typeof passToken !== "string") throw new Error(`createToken HTTP ${token.response.status}`);

    const authHeaders = { ...commonHeaders, "xx-operator": "pc", "xx-profile-id": "0", tokenPass: passToken };
    const profilesUrl = `${PROFILES_URL}?${new URLSearchParams({
      displayTemplate: "profilesSelection",
      allowedProfiles: "kids,adult",
      profilesTemplateVersion: "2",
    })}`;
    const [account, profiles] = await Promise.all([
      jsonRequest(HODOR_URL, { headers: authHeaders, method: "GET" }),
      jsonRequest(profilesUrl, { headers: authHeaders, method: "GET" }),
    ]);
    const accountFields = findAccountFields(account.body);
    const profileData = findProfiles(profiles.body);
    const accountIsValid = account.response.ok && Object.values(accountFields).some(Boolean);
    const expiryStatus = getExpiryStatus(accountFields["Date d'échéance"]);
    const profileMessage = profiles.response.ok
      ? `${profileData.profile_count} profil(s)`
      : `profils indisponibles (HTTP ${profiles.response.status})`;
    const isValid = accountIsValid && expiryStatus !== "expired";
    const message = !accountIsValid
      ? "!valide — Cookie Canal+ invalide"
      : expiryStatus === "expired"
        ? `!valide — abonnement expiré (${accountFields["Date d'échéance"]})`
        : `Valide — ${profileMessage}`;
    return { ...base, isValid, message, accountInfo: { ...accountFields, ...profileData, portailId, account_status: account.response.status, profiles_status: profiles.response.status, expiry_status: expiryStatus } };
  } catch (error) {
    return { ...base, isValid: false, message: `Erreur API: ${error instanceof Error ? error.message : "Inconnue"}`, accountInfo: {} };
  }
}
