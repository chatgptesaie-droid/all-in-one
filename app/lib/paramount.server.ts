import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const RENDER_API_URL = process.env.PARAMOUNT_API_URL || "https://netcookies-paramount-checker.onrender.com/";

interface PythonResult {
  is_valid: boolean;
  status: string;
  message: string;
  profile_count: number;
  profile_names: string[];
  account_details: {
    "Paramount+ Plan": string | null;
    "Price": string | null;
    "Next Billing Date": string | null;
    "Payment Method": string | null;
  };
  final_url: string;
  error?: boolean;
}

async function runPythonChecker(cookies: object[]): Promise<PythonResult> {
  const payload = { cookies };
  
  const response = await fetch(RENDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Paramount API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export async function validateParamountBatch(batch: CookieBatch): Promise<ValidationResult> {
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
    const pythonResult = await runPythonChecker(batch.cookies);

    const accountInfo: Record<string, any> = {
      final_url: pythonResult.final_url,
    };

    if (pythonResult.profile_names?.length > 0) {
      accountInfo.profile_names = pythonResult.profile_names;
      accountInfo.profile_count = pythonResult.profile_count;
      accountInfo.display_name = pythonResult.profile_names[0];
    }

    const details = pythonResult.account_details;
    if (details?.["Paramount+ Plan"]) accountInfo.plan = details["Paramount+ Plan"];
    if (details?.["Price"]) accountInfo.price = details["Price"];
    if (details?.["Next Billing Date"]) accountInfo.next_billing_date = details["Next Billing Date"];
    if (details?.["Payment Method"]) accountInfo.payment_method = details["Payment Method"];

    return {
      batchIndex: batch.index,
      isValid: pythonResult.is_valid,
      message: pythonResult.message,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo,
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };

  } catch (err) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Erreur: ${err instanceof Error ? err.message : "Inconnue"}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }
}
