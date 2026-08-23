import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const API_URL = "https://commerce-api-sg.capcut.com/commerce/v1/benefits/user_credit";
const SUBSCRIPTION_URL = "https://commerce-api-sg.capcut.com/commerce/v1/subscription/user_info";
const SUBSCRIPTION_INFOS_URL = "https://commerce-api-sg.capcut.com/commerce/v3/trade/subscription_infos";

export function parseCapcutCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const blocks = content.replace(/\r/g, "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    const cookies = block.split("\n").flatMap((line) => parseCookieLine(line));
    if (cookies.length > 0) batches.push({ index: batches.length + 1, cookies, rawLine: block.slice(0, 120) });
  }
  if (batches.length === 0) {
    const cookies = content.split("\n").flatMap((line) => parseCookieLine(line));
    if (cookies.length > 0) batches.push({ index: 1, cookies, rawLine: content.slice(0, 120) });
  }
  return batches;
}

function parseCookieLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) return [];
  const normalized = trimmed.startsWith("#HttpOnly_") ? trimmed.slice(10) : trimmed;
  const fields = normalized.split("\t");
  if (fields.length >= 7) return [{ domain: fields[0], flag: fields[1], path: fields[2] || "/", secure: fields[3].toUpperCase() === "TRUE", expiry: fields[4], name: fields[5], value: fields.slice(6).join("\t") }];
  return normalized.split(";").flatMap((pair) => {
    const separator = pair.indexOf("=");
    if (separator < 1) return [];
    return [{ domain: ".capcut.com", flag: "TRUE", path: "/", secure: true, expiry: "0", name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim() }];
  });
}

async function postCapcut(url: string, cookies: CookieBatch["cookies"], payload: Record<string, unknown>) {
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await fetch(url, { method: "POST", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135 Safari/537.36", Accept: "application/json, text/plain, */*", "Content-Type": "application/json", Origin: "https://www.capcut.com", Referer: "https://www.capcut.com/", appId: "348188", lan: "fr-FR", pf: "7", Cookie: cookieHeader }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, dataIsNull: body === null || (typeof body === "object" && body.data === null) };
}

export async function validateCapcutBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = { batchIndex: batch.index, netflixId: null, cookiesData: batch.cookies, netscapeFormat: formatBatchNetscape(batch.cookies) };
  if (batch.cookies.length === 0) return { ...base, isValid: false, message: "Aucun cookie CapCut fourni", accountInfo: {} };
  try {
    const [credit, subscription, infos] = await Promise.all([postCapcut(API_URL, batch.cookies, {}), postCapcut(SUBSCRIPTION_URL, batch.cookies, { aid: "348188", scene: "vip" }), postCapcut(SUBSCRIPTION_INFOS_URL, batch.cookies, { scene: ["vip", "workspace"], vip_levels: ["vip"], app_id: 348188 })]);
    const accountInfo = { credit: credit.body?.data?.credit || {}, workspace_subscribe_info: subscription.body?.data?.workspace_subscribe_info || {}, subscription_user_infos: infos.body?.data?.subscription_user_infos || {}, status_code: credit.status };
    const isValid = [credit, subscription, infos].every((result) => result.status < 400 && !result.dataIsNull);
    return { ...base, isValid, message: isValid ? "Cookie CapCut valide" : "Cookie CapCut invalide ou data manquante", accountInfo };
  } catch (error) { return { ...base, isValid: false, message: `Erreur de connexion: ${error instanceof Error ? error.message : "Inconnue"}`, accountInfo: {} }; }
}