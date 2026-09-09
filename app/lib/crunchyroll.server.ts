import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

function makeResult(batch: CookieBatch, isValid: boolean, message: string, accountInfo: Record<string, unknown>): ValidationResult {
  return { batchIndex: batch.index, isValid, message, netflixId: null, cookiesData: batch.cookies, accountInfo, netscapeFormat: formatBatchNetscape(batch.cookies) };
}

export async function validateCrunchyrollBatch(batch: CookieBatch): Promise<ValidationResult> {
  const apiUrl = process.env.CRUNCHYROLL_API_URL?.replace(/\/$/, "");
  if (!apiUrl) return makeResult(batch, false, "CRUNCHYROLL_API_URL n'est pas configurée", {});

  try {
    const response = await fetch(`${apiUrl}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cookies: formatBatchNetscape(batch.cookies) }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => ({})) as { isValid?: boolean; message?: string; accountInfo?: Record<string, unknown> };
    if (!response.ok) return makeResult(batch, false, data.message || `API Flask Crunchyroll HTTP ${response.status}`, data.accountInfo || {});
    return makeResult(batch, data.isValid === true, data.message || "Résultat Crunchyroll", data.accountInfo || {});
  } catch (error) {
    return makeResult(batch, false, `API Flask Crunchyroll inaccessible: ${error instanceof Error ? error.message : "Inconnue"}`, {});
  }
}
