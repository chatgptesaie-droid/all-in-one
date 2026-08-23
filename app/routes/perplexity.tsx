import { useState, useCallback, useEffect } from "react";
import * as validator from "../lib/perplexity.validator";
import type { PerplexityResult } from "../lib/perplexity.validator";

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

export function meta() {
  return [{ title: "Perplexity Cookies Validator" }, { name: "description", content: "Validateur de cookies Perplexity" }];
}

export default function PerplexityPage() {
  const [cookieText, setCookieText] = useState("");
  const [results, setResults] = useState<PerplexityResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [selectedResult, setSelectedResult] = useState<PerplexityResult | null>(null);
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Pret");
  const [threads, setThreads] = useState(1);

  const validCount = results.filter((r) => r.isValid).length;
  const invalidCount = results.filter((r) => !r.isValid).length;

  const start = useCallback(() => {
    if (!cookieText.trim()) return;
    setResults([]);
    setSelectedResult(null);
    setProgress(0);
    validator.startValidation(cookieText, threads);
  }, [cookieText, threads]);

  const stop = useCallback(() => {
    validator.stopValidation();
    setIsValidating(false);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setCookieText(content);
      setFileLoaded(file.name);
      setResults([]);
      setSelectedResult(null);
    };
    reader.readAsText(file);
  }, []);

  const handleMultipleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let all = "";
    let loaded = 0;
    Array.from(files).forEach((file) => {
      const r = new FileReader();
      r.onload = (ev) => {
        all += `# --- ${file.name} ---\n` + (ev.target?.result as string) + "\n\n";
        loaded++;
        if (loaded === files.length) {
          setCookieText(all);
          setFileLoaded(`${files.length} fichiers`);
          setResults([]);
          setSelectedResult(null);
        }
      };
      r.readAsText(file);
    });
  }, []);

  const reset = useCallback(() => {
    setCookieText("");
    setResults([]);
    setSelectedResult(null);
    setFileLoaded(null);
    setProgress(0);
    setTotalBatches(0);
    setStatusMessage("Pret");
  }, []);

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
        setStatusMessage("Validation démarrée");
      } else if (event.type === "result") {
        setResults((prev) => [...prev, event.data]);
        setProgress(event.progress || 0);
      } else if (event.type === "done") {
        setIsValidating(false);
        setStatusMessage(`Terminé - ${event.valid} valides, ${event.invalid} invalides`);
      } else if (event.type === "error") {
        setStatusMessage(`Erreur: ${event.message}`);
        setIsValidating(false);
      } else if (event.type === "start") {
        setIsValidating(true);
        setStatusMessage("Validation en cours...");
      } else if (event.type === "stop" || event.type === "stopped") {
        setIsValidating(false);
        setStatusMessage("Validation arrêtée");
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <header className="shrink-0 z-20 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Perplexity Cookie Checker
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              Validation et extraction des informations de compte
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isValidating && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{statusMessage}</span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Toolbar */}
          <div className="shrink-0 z-10 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="btn-secondary w-full sm:w-auto">
                Charger fichier
                <input type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} disabled={isValidating} />
              </label>
              <label className="btn-secondary w-full sm:w-auto">
                Charger dossier
                <input type="file" accept=".txt" multiple className="hidden" onChange={handleMultipleFiles} disabled={isValidating} {...({ webkitdirectory: "", directory: "" } as any)} />
              </label>

              <div className="hidden h-6 w-px sm:mx-1 sm:block" style={{ background: "var(--border)" }} />

              {/* Sélecteur de threads */}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Threads:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => !isValidating && setThreads(n)}
                    disabled={isValidating}
                    className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${threads === n ? "btn-primary" : "btn-secondary"}`}
                    style={{ padding: 0, minWidth: "1.75rem" }}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className="hidden h-6 w-px sm:mx-1 sm:block" style={{ background: "var(--border)" }} />

              <button onClick={start} disabled={isValidating || !cookieText.trim()} className="btn-primary w-full sm:w-auto">
                {isValidating ? "Validation..." : "Lancer la validation"}
              </button>
              <button onClick={reset} disabled={isValidating} className="btn-secondary w-full sm:w-auto">
                Reset
              </button>
              {isValidating && (
                <button onClick={stop} className="btn-danger w-full sm:w-auto">Arrêter</button>
              )}
              {fileLoaded && (
                <span className="text-xs sm:ml-auto" style={{ color: "var(--text-subtle)" }}>{fileLoaded}</span>
              )}
            </div>

            {/* Progress */}
            {isValidating && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}>
                  <span>{results.length} / {totalBatches} traités</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}>
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          {results.length === 0 && !isValidating && (
            <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Cookies Perplexity (format Netscape)
              </label>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder={`.perplexity.ai\tTRUE\t/\tTRUE\t0\tname\tvaleur...`}
                className="textarea-surface"
              />
            </div>
          )}

          {/* Results table */}
          <div className="flex-1 overflow-auto min-h-0" style={{ background: "var(--bg)" }}>
            {results.length > 0 && (
              <div className="px-4 py-3 sm:px-6">
                <div className="overflow-x-auto rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
                  <table className="min-w-[500px] w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface)" }}>
                      <tr className="text-left text-[11px] uppercase tracking-wider border-b" style={{ color: "var(--text-subtle)", borderColor: "var(--border)" }}>
                        <th className="px-3 py-2.5 w-8">#</th>
                        <th className="px-3 py-2.5 w-20">Statut</th>
                        <th className="px-3 py-2.5">Email</th>
                        <th className="px-3 py-2.5 hidden sm:table-cell">Plan</th>
                        <th className="px-3 py-2.5 hidden md:table-cell">Type</th>
                        <th className="px-3 py-2.5 hidden sm:table-cell">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr
                          key={result.batchIndex}
                          onClick={() => setSelectedResult(result)}
                          className={`table-row-hover cursor-pointer ${selectedResult?.batchIndex === result.batchIndex ? "row-selected" : ""}`}
                          style={{ borderBottom: "1px solid var(--border-subtle)" }}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs" style={{ color: "var(--text-subtle)" }}>{result.batchIndex}</td>
                          <td className="px-3 py-2.5">
                            <span className={result.isValid ? "badge-valid" : "badge-invalid"}>
                              <span className={`w-1.5 h-1.5 rounded-full ${result.isValid ? "bg-emerald-400" : "bg-red-400"}`} />
                              {result.isValid ? "Valide" : "Invalide"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs truncate max-w-[160px]" style={{ color: "var(--text)" }}>
                            {(result.accountInfo?.email as string) || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs hidden sm:table-cell" style={{ color: "var(--text)" }}>
                            {(result.accountInfo?.plan as string) || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs hidden md:table-cell" style={{ color: "var(--text-muted)" }}>
                            {result.accountInfo?.isPro ? "Pro" : result.accountInfo?.plan ? "Gratuit" : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs truncate max-w-[180px] hidden sm:table-cell" style={{ color: "var(--text-subtle)" }}>
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

          {/* Mobile detail panel */}
          {selectedResult && (
            <div className="border-t lg:hidden overflow-y-auto max-h-[55vh]" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>
                  Détail #{selectedResult.batchIndex}
                </span>
                <button onClick={() => setSelectedResult(null)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-muted)", background: "var(--bg-surface-alt)" }}>
                  ✕ Fermer
                </button>
              </div>
              <PerplexityDetails result={selectedResult} />
            </div>
          )}

          {/* Stats footer */}
          {results.length > 0 && (
            <div className="shrink-0 z-10 border-t px-4 py-2.5 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-3 text-xs sm:gap-6">
                <span style={{ color: "var(--text-muted)" }}>Total: <span className="font-medium" style={{ color: "var(--text)" }}>{results.length}</span></span>
                <span style={{ color: "var(--text-muted)" }}>Valides: <span className="text-emerald-500 font-medium">{validCount}</span></span>
                <span style={{ color: "var(--text-muted)" }}>Invalides: <span className="text-red-400 font-medium">{invalidCount}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Details */}
        <aside className="hidden lg:flex lg:flex-col w-[400px] border-l overflow-y-auto" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          {selectedResult ? (
            <PerplexityDetails result={selectedResult} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Sélectionnez un résultat</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PerplexityDetails({ result }: { result: PerplexityResult }) {
  const info = result.accountInfo;

  return (
    <div className="p-4 space-y-4 sm:p-5 sm:space-y-5">
      {/* Status */}
      <div className={result.isValid ? "detail-valid" : "detail-invalid"}>
        <p className={`text-sm font-medium ${result.isValid ? "detail-valid-text" : "detail-invalid-text"}`}>
          {result.isValid ? "Cookie Valide" : "Cookie Invalide"}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{result.message}</p>
      </div>

      {/* Account info */}
      {result.isValid && info && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: "var(--text-subtle)" }}>
            Informations du compte
          </h3>
          <div className="space-y-1.5">
            {info.email && <InfoRow label="Email" value={info.email as string} />}
            {info.display_name && <InfoRow label="Nom" value={info.display_name as string} />}
            {info.plan && <InfoRow label="Forfait" value={info.plan as string} />}
            <InfoRow label="Type" value={info.isPro ? "Pro" : "Gratuit"} />
            {info.account_status && <InfoRow label="Statut" value={info.account_status as string} />}
          </div>
        </section>
      )}

      {/* Cookies Netscape */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-subtle)" }}>
            Cookies (Netscape)
          </h3>
          <button
            onClick={() => copyText(result.netscapeFormat)}
            className="text-[11px] transition-colors hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            Copier
          </button>
        </div>
        <pre className="text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all max-h-[280px] overflow-auto" style={{ color: "var(--text-subtle)", background: "var(--bg)", borderColor: "var(--border)" }}>
          {result.netscapeFormat}
        </pre>
      </section>

      {/* Cookie list */}
      {result.cookiesData?.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>
            Détail des cookies ({result.cookiesData.length})
          </h3>
          <div className="rounded-lg border divide-y" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            {result.cookiesData.map((cookie, idx) => (
              <div key={idx} className="px-3 py-2 flex items-center gap-3" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="text-[11px] text-blue-400/80 font-medium shrink-0 w-[130px] truncate">{cookie.name}</span>
                <span className="text-[11px] truncate flex-1" style={{ color: "var(--text-subtle)" }}>
                  {cookie.value.length > 60 ? cookie.value.substring(0, 60) + "..." : cookie.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-xs text-right truncate" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}
