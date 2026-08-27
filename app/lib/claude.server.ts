import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";
const CLAUDE_API_URL = (process.env.CLAUDE_API_URL || "http://localhost:5002").replace(/\/$/, "");

export function parseClaudeCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const lines = content.replace(/\r/g, "").split("\n");
  let current: string[] = [];

  const flush = () => {
    if (!current.length) return;
    const cookies = current.flatMap(parseCookieLine);
    if (cookies.length) batches.push({ index: batches.length + 1, cookies, rawLine: current[0].slice(0, 120) });
    current = [];
  };

  for (const line of lines) {
    const marker = line.trim();
    if (
      marker === "# Netscape HTTP Cookie File" ||
      marker.startsWith("FILE:") ||
      /^# ---\s*.+?\s*---$/.test(marker)
    ) {
      flush();
      current = marker === "# Netscape HTTP Cookie File" ? [line] : [];
    } else {
      current.push(line);
    }
  }
  flush();

  if (!batches.length) {
    const cookies = content.split("\n").flatMap(parseCookieLine);
    if (cookies.length) batches.push({ index: 1, cookies, rawLine: content.slice(0, 120) });
  }
  return batches;
}

function parseCookieLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) return [];
  const normalized = trimmed.startsWith("#HttpOnly_") ? trimmed.slice(10) : trimmed;
  const fields = normalized.split("\t");
  if (fields.length < 7 || !fields[5] || !fields[6]) return [];
  return [{ domain: fields[0], flag: fields[1], path: fields[2] || "/", secure: fields[3].toUpperCase() === "TRUE", expiry: fields[4], name: fields[5], value: fields.slice(6).join("\t") }];
}

function getCookieMap(cookies: CookieBatch["cookies"]) {
  return new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
}

async function fetchBootstrap(cookies: CookieBatch["cookies"]): Promise<{ response: Response; body: any }> {
  return fetch(`${CLAUDE_API_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies }),
    signal: AbortSignal.timeout(180_000),
  }).then(async (response) => ({ response, body: await response.json().catch(() => null) }));
}

export async function validateClaudeBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = { batchIndex: batch.index, isValid: false, message: "", netflixId: null, cookiesData: batch.cookies, accountInfo: {}, netscapeFormat: formatBatchNetscape(batch.cookies) };
  try {
    const { response, body } = await fetchBootstrap(batch.cookies);
    if (!response.ok) {
      const errorDetail = typeof body === "string"
        ? body.slice(0, 300)
        : body && typeof body === "object"
          ? JSON.stringify(body).slice(0, 500)
          : "";
      return { ...base, message: `HTTP ${response.status}${errorDetail ? ` — ${errorDetail}` : ""}` };
    }

    if (body?.error || body?.message && !body?.is_valid) return { ...base, message: body.message || body.error };
    const accountInfo = {
      email: body.email || "-",
      name: body.name || "-",
      uuid: body.uuid || "-",
      plan: body.plan || "-",
      rate_upsell: body.rate_upsell || "-",
      org_name: body.org_name || "-",
      org_id: body.org_id || getCookieMap(batch.cookies).get("lastActiveOrg") || "-",
      features: Array.isArray(body.features) ? body.features : [],
    };
    return { ...base, isValid: body.is_valid === true, message: body.message || "Cookie Claude invalide", accountInfo };
  } catch (error) {
    return { ...base, message: `Erreur API: ${error instanceof Error ? error.message : "Inconnue"}` };
  }
}
