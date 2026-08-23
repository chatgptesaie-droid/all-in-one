import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

export function parsePerplexityCookiesFromText(content: string): CookieBatch[] {
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
  if (fields.length >= 7) {
    return [{
      domain: fields[0],
      flag:   fields[1],
      path:   fields[2] || "/",
      secure: fields[3].toUpperCase() === "TRUE",
      expiry: fields[4],
      name:   fields[5],
      value:  fields.slice(6).join("\t"),
    }];
  }
  return normalized.split(";").flatMap((pair) => {
    const sep = pair.indexOf("=");
    if (sep < 1) return [];
    return [{
      domain: ".perplexity.ai",
      flag:   "TRUE",
      path:   "/",
      secure: true,
      expiry: "0",
      name:   pair.slice(0, sep).trim(),
      value:  pair.slice(sep + 1).trim(),
    }];
  });
}

// ---------------------------------------------------------------------------
// Appel du service Selenium distant, comme le service Paramount.
const PERPLEXITY_API_URL = (process.env.PERPLEXITY_API_URL || "http://localhost:5000").replace(/\/$/, "");

interface PyResult {
  is_valid: boolean;
  status: string;
  email: string | null;
  display_name: string | null;
  plan: string;
  has_upgrade: boolean;
  account_accessible: boolean;
  account_status: string;
  message: string;
  injected_count: number;
}

async function runPerplexityChecker(cookies: CookieBatch["cookies"]): Promise<PyResult> {
  const response = await fetch(`${PERPLEXITY_API_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies }),
    signal: AbortSignal.timeout(180_000),
  });

  const data = await response.json().catch(() => ({})) as Partial<PyResult> & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as PyResult;
}
// Validation principale
// ---------------------------------------------------------------------------

export async function validatePerplexityBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = {
    batchIndex:     batch.index,
    netflixId:      null,
    cookiesData:    batch.cookies,
    netscapeFormat: formatBatchNetscape(batch.cookies),
  };

  if (batch.cookies.length === 0) {
    return { ...base, isValid: false, message: "Aucun cookie Perplexity fourni", accountInfo: {} };
  }

  try {
    const data = await runPerplexityChecker(batch.cookies);

    const accountInfo = {
      email:              data.email       || null,
      display_name:       data.display_name || null,
      plan:               data.plan,
      has_upgrade:        data.has_upgrade,
      account_accessible: data.account_accessible,
      account_status:     data.account_status,
      injected_count:     data.injected_count,
      // Compatibilité champ isPro utilisé dans la vue
      isPro:              data.is_valid && !data.has_upgrade,
      status:             data.account_status,
    };

    return {
      ...base,
      isValid: data.is_valid,
      message: data.message,
      accountInfo,
    };
  } catch (error) {
    return {
      ...base,
      isValid: false,
      message: `Erreur: ${error instanceof Error ? error.message : "Inconnue"}`,
      accountInfo: {},
    };
  }
}
