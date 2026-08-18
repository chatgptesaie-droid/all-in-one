import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const FLASK_API_URL = process.env.PARAMOUNT_API_URL || "http://localhost:5000";

interface FlaskResult {
  is_valid: boolean;
  status: string;
  message: string;
  profile_count?: number;
  profile_names?: string[];
  account_details?: {
    "Paramount+ Plan"?: string | null;
    "Price"?: string | null;
    "Next Billing Date"?: string | null;
    "Payment Method"?: string | null;
  };
  final_url?: string;
  error?: string;
}

export async function validateParamountBatch(
  batch: CookieBatch,
  proxyUrl: string = ""
): Promise<ValidationResult> {
  if (batch.cookies.length === 0) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: "Aucun cookie trouvé",
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }

  try {
    const resp = await fetch(`${FLASK_API_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: batch.cookies,
        proxy_url: proxyUrl || null,
      }),
      signal: AbortSignal.timeout(180_000), // 3 min max (Selenium est lent)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const data = await resp.json() as FlaskResult;

    const accountInfo: Record<string, any> = {
      final_url: data.final_url || "",
    };

    if (data.profile_names?.length) {
      accountInfo.profile_names = data.profile_names;
      accountInfo.profile_count = data.profile_count;
      accountInfo.display_name = data.profile_names[0];
    }

    const details = data.account_details;
    if (details?.["Paramount+ Plan"]) accountInfo.plan = details["Paramount+ Plan"];
    if (details?.["Price"]) accountInfo.price = details["Price"];
    if (details?.["Next Billing Date"]) accountInfo.next_billing_date = details["Next Billing Date"];
    if (details?.["Payment Method"]) accountInfo.payment_method = details["Payment Method"];

    // Pays de l'IP sortante (proxy ou serveur)
    if ((data as any).user_country) accountInfo.country = (data as any).user_country;

    return {
      batchIndex: batch.index,
      isValid: data.is_valid,
      message: data.message,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo,
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };

  } catch (err) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Erreur API: ${err instanceof Error ? err.message : "Inconnue"}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }
}
