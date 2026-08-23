import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const SCRIBD_API_URL = (process.env.SCRIBD_API_URL || "http://localhost:5001").replace(/\/$/, "");

type ScribdCookie = CookieBatch["cookies"][number];
type ScribdPayload = { valid?: boolean; redirected_to_home?: boolean; final_url?: string; parsed_cookie_count?: number; scribd_cookie_count?: number; injected_cookie_count?: number; skipped_cookie_count?: number; account?: Record<string, unknown>; indicators?: Record<string, boolean>; message?: string };

function isScribdDomain(domain: string) {
  const normalized = domain.toLowerCase().replace(/^\./, "");
  return normalized === "scribd.com" || normalized.endsWith(".scribd.com");
}

function parseLine(line: string): ScribdCookie[] {
  const trimmed = line.trim();
  if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) return [];
  const normalized = trimmed.startsWith("#HttpOnly_") ? trimmed.slice(10) : trimmed;
  const fields = normalized.split("\t");
  if (fields.length < 7 || !fields[5]) return [];
  return [{ domain: fields[0], flag: fields[1], path: fields[2] || "/", secure: fields[3].toUpperCase() === "TRUE", expiry: fields[4], name: fields[5], value: fields.slice(6).join("\t") }];
}

export function parseScribdCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const groups = content.replace(/\r/g, "").split(/\n\s*\n/).map((group) => group.trim()).filter(Boolean);
  for (const group of groups) {
    const cookies = group.split("\n").flatMap(parseLine).filter((cookie) => isScribdDomain(cookie.domain));
    if (cookies.length) batches.push({ index: batches.length + 1, cookies, rawLine: group.slice(0, 120) });
  }
  return batches;
}

async function runScribdChecker(cookies: ScribdCookie[]): Promise<ScribdPayload> {
  const response = await fetch(`${SCRIBD_API_URL}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookies }), signal: AbortSignal.timeout(180_000) });
  const data = await response.json().catch(() => ({})) as ScribdPayload & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function validateScribdBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = { batchIndex: batch.index, netflixId: null, cookiesData: batch.cookies, netscapeFormat: formatBatchNetscape(batch.cookies) };
  if (!batch.cookies.length) return { ...base, isValid: false, message: "Aucun cookie Scribd fourni", accountInfo: {} };
  try {
    const data = await runScribdChecker(batch.cookies);
    const account = data.account || {};
    const isValid = data.valid === true && data.redirected_to_home === true;
    const accountInfo = { ...account, final_url: data.final_url || "", redirected_to_home: data.redirected_to_home === true, parsed_cookie_count: data.parsed_cookie_count, scribd_cookie_count: data.scribd_cookie_count, injected_cookie_count: data.injected_cookie_count, skipped_cookie_count: data.skipped_cookie_count, indicators: data.indicators || {} };
    return { ...base, isValid, message: isValid ? "Cookie Scribd valide — redirige vers /home" : data.message || "Cookie Scribd invalide", accountInfo };
  } catch (error) {
    return { ...base, isValid: false, message: `Erreur API: ${error instanceof Error ? error.message : "Inconnue"}`, accountInfo: {} };
  }
}
