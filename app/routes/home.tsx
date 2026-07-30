import { useState, useCallback, useEffect } from "react";
import * as validator from "../lib/validator";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Netflix Cookies Validator" },
    {
      name: "description",
      content: "Validateur de cookies Netflix - Interface Web",
    },
  ];
}

interface CookieEntry {
  domain: string;
  flag: string;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
}

interface AccountInfo {
  profileName?: string;
  memberSince?: string;
  countryOfSignup?: string;
  videoQuality?: string;
  planName?: string;
  plan?: string;
  plan_label?: string;
  maxStreams?: number;
  planPrice?: string;
  paymentMethod?: string;
  last4Digit?: string;
  paymentType?: string;
  nextBillingDate?: string;
  membershipStatus?: string;
  hasExtraSlot?: boolean;
  accountStatus?: string;
  final_url?: string;
  [key: string]: unknown;
}

interface ValidationResult {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: CookieEntry[];
  accountInfo: AccountInfo;
  netscapeFormat: string;
}

/**
 * Decode unicode (\uXXXX) and hex (\xXX) escape sequences in a string
 */
function decodeEscapes(str: string): string {
  if (!str) return str;
  try {
    // Replace \xNN sequences
    let result = str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    // Replace \uNNNN sequences
    result = result.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    return result;
  } catch {
    return str;
  }
}

export default function Home() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(
    null
  );
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [cookieText, setCookieText] = useState("");
  const [statusMessage, setStatusMessage] = useState("Pret");

  const validCount = results.filter((r) => r.isValid).length;
  const invalidCount = results.filter((r) => !r.isValid).length;

  useEffect(() => {
    const validResults = results.filter((r) => r.isValid);
    try {
      window.localStorage.setItem(
        "netflix-validator-valid-results",
        JSON.stringify(validResults)
      );
    } catch {
      // ignore write errors
    }
  }, [results]);

  // subscribe to global validator so stream continues across routes
  useEffect(() => {
    const unsub = validator.subscribe((event) => {
      if (event.type === "snapshot") {
        setResults(event.results || []);
        setIsValidating(!!event.running);
        setProgress(event.progress || 0);
        setTotalBatches(event.total || 0);
        setStatusMessage(event.statusMessage || "Pret");
      } else if (event.type === "init") {
        setTotalBatches(event.total || 0);
      } else if (event.type === "result") {
        setResults((prev) => [...prev, event.data]);
        setProgress(event.progress || 0);
      } else if (event.type === "done") {
        setStatusMessage(`Termine - ${event.valid} valides, ${event.invalid} invalides`);
        setIsValidating(false);
      } else if (event.type === "error") {
        setStatusMessage(`Erreur: ${event.message}`);
      } else if (event.type === "start") {
        setIsValidating(true);
      } else if (event.type === "stop" || event.type === "stopped") {
        setIsValidating(false);
      }
    });
    return () => unsub();
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCookieText(content);
        setFileLoaded(file.name);
        setStatusMessage(`Fichier charge: ${file.name}`);
        setResults([]);
        setSelectedResult(null);
      };
      reader.readAsText(file);
    },
    []
  );

  const handleMultipleFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      let allContent = "";
      let loaded = 0;

      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          allContent +=
            `# --- ${file.name} ---\n` +
            (event.target?.result as string) +
            "\n\n";
          loaded++;
          if (loaded === files.length) {
            setCookieText(allContent);
            setFileLoaded(`${files.length} fichiers`);
            setStatusMessage(`${files.length} fichiers charges`);
            setResults([]);
            setSelectedResult(null);
          }
        };
        reader.readAsText(file);
      });
    },
    []
  );

  const startValidation = useCallback(() => {
    if (!cookieText.trim()) {
      setStatusMessage("Aucun cookie a tester");
      return;
    }

    setResults([]);
    setSelectedResult(null);
    setProgress(0);
    setStatusMessage("Validation en cours...");

    validator.startValidation(cookieText);
  }, [cookieText]);

  const stopValidation = useCallback(() => {
    validator.stopValidation();
    setIsValidating(false);
    setStatusMessage("Validation arretee");
  }, []);

  const exportTxt = useCallback(() => {
    const validResults = results.filter((r) => r.isValid);
    if (validResults.length === 0) return;

    let content = "# Netscape HTTP Cookie File\n";
    content += `# Export: ${new Date().toLocaleString("fr-FR")}\n`;
    content += `# ${validResults.length} cookies valides\n\n`;

    for (const result of validResults) {
      content += result.netscapeFormat + "\n\n";
    }

    downloadFile(content, "text/plain", `valid_cookies_${dateStamp()}.txt`);
  }, [results]);

  const exportJSON = useCallback(() => {
    const validResults = results.filter((r) => r.isValid);
    if (validResults.length === 0) return;

    const data = {
      exportTime: new Date().toISOString(),
      totalValid: validResults.length,
      cookies: validResults,
    };

    downloadFile(
      JSON.stringify(data, null, 2),
      "application/json",
      `valid_cookies_${dateStamp()}.json`
    );
  }, [results]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 flex flex-col overflow-x-hidden">
      {/* Header - fixed */}
      <header className="bg-[#111118] border-b border-gray-800 px-4 py-4 shrink-0 z-10 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-w-[1800px] mx-auto">
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              Netflix Cookie Validator
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Validation et extraction de donnees
            </p>
          </div>
          <StatusBadge message={statusMessage} isValidating={isValidating} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-hidden min-h-0 lg:flex-row">
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 lg:pr-[400px]">
          {/* Toolbar - fixed */}
          <div className="bg-[#111118] border-b border-gray-800 px-4 py-3 shrink-0 z-10 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center max-w-[1800px] mx-auto">
              <label className="btn-secondary w-full sm:w-auto">
                Charger fichier
                <input
                  type="file"
                  accept=".txt,.json"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isValidating}
                />
              </label>

              <label className="btn-secondary w-full sm:w-auto">
                Charger dossier
                <input
                  type="file"
                  accept=".txt"
                  multiple
                  className="hidden"
                  onChange={handleMultipleFiles}
                  disabled={isValidating}
                  {...({ webkitdirectory: "", directory: "" } as any)}
                />
              </label>

              <div className="hidden h-6 w-px bg-gray-700 sm:mx-1 sm:block" />

              <button
                onClick={startValidation}
                disabled={isValidating || !cookieText.trim()}
                className="btn-primary w-full sm:w-auto"
              >
                {isValidating ? "Validation..." : "Lancer la validation"}
              </button>

              {isValidating && (
                <button onClick={stopValidation} className="btn-danger w-full sm:w-auto">
                  Arreter
                </button>
              )}

              {validCount > 0 && !isValidating && (
                <>
                  <div className="hidden h-6 w-px bg-gray-700 sm:mx-1 sm:block" />
                  <button onClick={exportTxt} className="btn-secondary w-full sm:w-auto">
                    Export TXT
                  </button>
                  <button onClick={exportJSON} className="btn-secondary w-full sm:w-auto">
                    Export JSON
                  </button>
                </>
              )}

              {fileLoaded && (
                <span className="text-xs text-gray-500 sm:ml-auto">
                  {fileLoaded}
                </span>
              )}
            </div>

            {/* Progress */}
            {isValidating && (
              <div className="max-w-[1800px] mx-auto mt-3">
                <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                  <span>
                    {results.length} / {totalBatches} traites
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-red-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Input area (shown when no results) */}
          {results.length === 0 && !isValidating && (
            <div className="p-4 shrink-0 max-w-[1800px] mx-auto w-full sm:p-6">
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">
                Cookies (format Netscape ou texte brut)
              </label>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder={`.netflix.com\tTRUE\t/\tTRUE\t0\tNetflixId\tvaleur...\n.netflix.com\tTRUE\t/\tTRUE\t0\tSecureNetflixId\tvaleur...`}
                className="w-full h-44 bg-[#16161e] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 font-mono resize-y focus:outline-none focus:border-gray-600 placeholder:text-gray-700"
              />
            </div>
          )}

          {/* Results table - scrollable */}
          <div className="flex-1 overflow-auto min-h-0">
            {results.length > 0 && (
              <div className="max-w-[1800px] mx-auto px-4 py-4 sm:px-6">
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-[#0a0a0f] z-5">
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                        <th className="px-3 py-2.5 w-10">#</th>
                        <th className="px-3 py-2.5 w-20">Statut</th>
                        <th className="px-3 py-2.5">Profil</th>
                        <th className="px-3 py-2.5">Plan</th>
                        <th className="px-3 py-2.5">Pays</th>
                        <th className="px-3 py-2.5">Facturation</th>
                        <th className="px-3 py-2.5">URL finale</th>
                        <th className="px-3 py-2.5">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, idx) => (
                        <tr
                          key={idx}
                          onClick={() => setSelectedResult(result)}
                          className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                            selectedResult?.batchIndex === result.batchIndex
                              ? "bg-[#1a1a2e]"
                              : "hover:bg-[#12121a]"
                          }`}
                        >
                          <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">
                            {result.batchIndex}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                                result.isValid
                                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/50"
                                  : "bg-red-950/60 text-red-400 border border-red-800/50"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  result.isValid ? "bg-emerald-400" : "bg-red-400"
                                }`}
                              />
                              {result.isValid ? "Valide" : "Invalide"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">
                            {decodeEscapes(result.accountInfo?.profileName || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">
                            {decodeEscapes(result.accountInfo?.planName || result.accountInfo?.plan || result.accountInfo?.plan_label || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">
                            {result.accountInfo?.countryOfSignup || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">
                            {decodeEscapes(result.accountInfo?.nextBillingDate || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-[180px]">
                            {(result.accountInfo?.final_url as string) || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-[200px]">
                            {result.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {selectedResult && (
            <div className="border-t border-gray-800 bg-[#111118] lg:hidden">
              <ResultDetails result={selectedResult} />
            </div>
          )}

          {/* Stats footer - fixed */}
          {results.length > 0 && (
            <div className="bg-[#111118] border-t border-gray-800 px-4 py-2.5 shrink-0 z-10 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-xs max-w-[1800px] mx-auto sm:gap-6">
                <span className="text-gray-500">
                  Total:{" "}
                  <span className="text-gray-300 font-medium">
                    {results.length}
                  </span>
                </span>
                <span className="text-gray-500">
                  Valides:{" "}
                  <span className="text-emerald-400 font-medium">
                    {validCount}
                  </span>
                </span>
                <span className="text-gray-500">
                  Invalides:{" "}
                  <span className="text-red-400 font-medium">
                    {invalidCount}
                  </span>
                </span>
                <span className="text-gray-500">
                  Taux:{" "}
                  <span className="text-gray-300 font-medium">
                    {results.length > 0
                      ? Math.round((validCount / results.length) * 100)
                      : 0}
                    %
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Details (fixed) */}
        <aside className="hidden lg:block w-[400px] bg-[#111118] border-l border-gray-800 overflow-y-auto fixed right-0 top-0 bottom-0 pt-[73px]">
          {selectedResult ? (
            <ResultDetails result={selectedResult} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-600">
                Selectionnez un resultat
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// --- Components ---

function StatusBadge({
  message,
  isValidating,
}: {
  message: string;
  isValidating: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {isValidating && (
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      )}
      <span className="text-xs text-gray-500">{message}</span>
    </div>
  );
}

function ResultDetails({ result }: { result: ValidationResult }) {
  const [showFullCookies, setShowFullCookies] = useState(false);
  const info = result.accountInfo;

  return (
    <div className="p-4 space-y-4 sm:p-5 sm:space-y-5">
      {/* Status header */}
      <div
        className={`p-3 rounded-lg border ${
          result.isValid
            ? "bg-emerald-950/30 border-emerald-800/40"
            : "bg-red-950/30 border-red-800/40"
        }`}
      >
        <p
          className={`text-sm font-medium ${
            result.isValid ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {result.isValid ? "Cookie Valide" : "Cookie Invalide"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{result.message}</p>
      </div>

      {/* Final URL */}
      {info?.final_url && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-2">
            URL finale
          </h3>
          <p className="text-xs text-gray-400 font-mono bg-[#0a0a0f] rounded-lg p-3 border border-gray-800 break-all">
            {info.final_url as string}
          </p>
        </section>
      )}

      {/* NetflixId */}
      {result.netflixId && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              NetflixId
            </h3>
            <button
              onClick={() => navigator.clipboard.writeText(result.netflixId!)}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              Copier
            </button>
          </div>
          <pre className="text-[11px] text-gray-400 font-mono bg-[#0a0a0f] rounded-lg p-3 border border-gray-800 whitespace-pre-wrap break-all max-h-24 overflow-auto">
            {result.netflixId}
          </pre>
        </section>
      )}

      {/* Account info */}
      {result.isValid && Object.keys(info).length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-3">
            Informations du compte
          </h3>
          <div className="space-y-2">
            <InfoRow label="Profil" value={decodeEscapes(info.profileName || "")} />
            <InfoRow label="Plan" value={decodeEscapes(info.planName || info.plan || info.plan_label || "")} />
            <InfoRow label="Prix" value={decodeEscapes(info.planPrice || "")} />
            <InfoRow label="Qualite" value={info.videoQuality} />
            <InfoRow label="Pays" value={info.countryOfSignup} />
            <InfoRow label="Membre depuis" value={info.memberSince} />
            <InfoRow label="Prochaine facturation" value={decodeEscapes(info.nextBillingDate || "")} />
            <InfoRow label="Paiement" value={info.paymentMethod} />
            {info.last4Digit && (
              <InfoRow label="Carte" value={`**** ${info.last4Digit}`} />
            )}
            <InfoRow label="Statut" value={info.accountStatus} />
            <InfoRow label="Streams max" value={info.maxStreams?.toString()} />
            {info.hasExtraSlot !== undefined && (
              <InfoRow
                label="Slot supplementaire"
                value={info.hasExtraSlot ? "Oui" : "Non"}
              />
            )}
          </div>
        </section>
      )}

      {/* Cookies */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
            Cookies (Netscape)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFullCookies(!showFullCookies)}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showFullCookies ? "Reduire" : "Tout afficher"}
            </button>
            <button
              onClick={() =>
                navigator.clipboard.writeText(result.netscapeFormat)
              }
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              Copier
            </button>
          </div>
        </div>
        <pre
          className={`text-[11px] text-gray-500 font-mono bg-[#0a0a0f] rounded-lg p-3 border border-gray-800 whitespace-pre-wrap break-all ${
            showFullCookies ? "" : "max-h-28 overflow-hidden"
          }`}
        >
          {result.netscapeFormat}
        </pre>
      </section>

      {/* Cookie list */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-2">
          Detail des cookies ({result.cookiesData.length})
        </h3>
        <div className="bg-[#0a0a0f] rounded-lg border border-gray-800 divide-y divide-gray-800/50">
          {result.cookiesData.map((cookie, idx) => (
            <div key={idx} className="px-3 py-2 flex items-center gap-3">
              <span className="text-[11px] text-amber-500/80 font-medium shrink-0 w-[130px] truncate">
                {cookie.name}
              </span>
              <span className="text-[11px] text-gray-600 truncate flex-1">
                {cookie.value.length > 60
                  ? cookie.value.substring(0, 60) + "..."
                  : cookie.value}
              </span>
              {cookie.name === "NetflixId" && (
                <button
                  onClick={() => navigator.clipboard.writeText(cookie.value)}
                  className="shrink-0 text-[10px] text-gray-500 hover:text-white bg-[#1e1e2a] border border-gray-700 hover:border-gray-500 px-2 py-0.5 rounded transition-colors"
                >
                  Copier
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-gray-800/40">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-200 text-right truncate">
        {value}
      </span>
    </div>
  );
}

// --- Helpers ---

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
