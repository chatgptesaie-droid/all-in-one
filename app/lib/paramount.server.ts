import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";
import { execFile } from "node:child_process";
import * as path from "node:path";

const HTML_DUMP_DIR = path.join(process.cwd(), "paramount_html_dumps");
const SCRIPT_PATH = path.join(process.cwd(), "paramount_cookie_checker.py");

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

function runPythonChecker(cookies: object[]): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ cookies, dump_dir: HTML_DUMP_DIR });

    const child = execFile(
      "python",
      [SCRIPT_PATH],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stderr) console.error("[Paramount Python stderr]", stderr.slice(0, 500));
        if (err && !stdout) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`JSON parse error: ${stdout.slice(0, 200)}`));
        }
      }
    );

    child.stdin?.write(payload);
    child.stdin?.end();
  });
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
