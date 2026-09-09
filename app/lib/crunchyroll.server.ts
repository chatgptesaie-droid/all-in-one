import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

function runPython(cookieText: string): Promise<{ isValid: boolean; message: string; accountInfo: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const commands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
    const script = existsSync(join(process.cwd(), "cr_api_runner.py"))
      ? join(process.cwd(), "cr_api_runner.py")
      : join(process.cwd(), "..", "cr_api_runner.py");
    let commandIndex = 0;
    let stdout = "";
    let stderr = "";
    let child: ReturnType<typeof spawn> | null = null;

    const start = () => {
      const command = commands[commandIndex++];
      if (!command) {
        resolve({ isValid: false, message: "Python est introuvable sur le serveur", accountInfo: { runner_error: stderr.slice(0, 300) } });
        return;
      }
      stdout = "";
      stderr = "";
      const processChild = spawn(command, [script], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
      child = processChild;
      processChild.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      processChild.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      processChild.on("error", () => start());
      processChild.on("close", (code) => {
        if (code === 0 || stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as { isValid?: boolean; message?: string; accountInfo?: Record<string, unknown> };
            resolve({ isValid: parsed.isValid === true, message: parsed.message || "Résultat Crunchyroll", accountInfo: parsed.accountInfo || {} });
          } catch {
            resolve({ isValid: false, message: "Réponse Python invalide", accountInfo: { runner_output: stdout.slice(0, 300), runner_error: stderr.slice(0, 300) } });
          }
          return;
        }
        start();
      });
      processChild.stdin.write(cookieText);
      processChild.stdin.end();
    };
    start();
  });
}

export async function validateCrunchyrollBatch(batch: CookieBatch): Promise<ValidationResult> {
  const result = await runPython(formatBatchNetscape(batch.cookies));
  return {
    batchIndex: batch.index,
    isValid: result.isValid,
    message: result.message,
    netflixId: null,
    cookiesData: batch.cookies,
    accountInfo: result.accountInfo,
    netscapeFormat: formatBatchNetscape(batch.cookies),
  };
}
