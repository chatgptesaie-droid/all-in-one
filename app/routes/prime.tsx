import { useState, useCallback, useEffect } from "react";
import * as primeValidator from "../lib/prime.validator";

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

export default function PrimePage() {
  const [cookieText, setCookieText] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Pret");

  const validCount = results.filter((r) => r.isValid).length;
  const invalidCount = results.filter((r) => !r.isValid).length;

  useEffect(() => {
    const unsub = primeValidator.subscribe((event) => {
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
        setIsValidating(false);
        setStatusMessage(`Termine - ${event.valid} valides, ${event.invalid} invalides`);
      } else if (event.type === "error") {
        setIsValidating(false);
        setStatusMessage(`Erreur: ${event.message}`);
      } else if (event.type === "start") {
        setIsValidating(true);
        setStatusMessage("Validation en cours...");
      } else if (event.type === "stop" || event.type === "stopped") {
        setIsValidating(false);
        setStatusMessage("Validation arretée");
      }
    });
    return () => unsub();
  }, []);

  const start = useCallback(() => {
    if (!cookieText.trim()) return;
    setResults([]);
    setSelectedResult(null);
    setProgress(0);
    primeValidator.startValidation(cookieText);
  }, [cookieText]);

  const stop = useCallback(() => {
    primeValidator.stopValidation();
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
      setStatusMessage(`Fichier chargé: ${file.name}`);
    };
    reader.readAsText(file);
  }, []);

  const handleMultipleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let all = "";
    let loaded = 0;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        all += `# --- ${file.name} ---\n` + (ev.target?.result as string) + "\n\n";
        loaded++;
        if (loaded === files.length) {
          setCookieText(all);
          setFileLoaded(`${files.length} fichiers`);
          setResults([]);
          setSelectedResult(null);
          setStatusMessage(`${files.length} fichiers chargés`);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <header className="shrink-0 z-20 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Prime Video Cookie Checker
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              Détection Free/Premium via la page d'accueil Prime Video
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isValidating && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
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
              <button onClick={start} disabled={isValidating || !cookieText.trim()} className="btn-primary w-full sm:w-auto">
                {isValidating ? "Validation..." : "Lancer la validation"}
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
                  <div className="bg-amber-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          {results.length === 0 && !isValidating && (
            <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Cookies (format Netscape ou texte brut)
              </label>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder="Pastez vos cookies Netscape ici"
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
                        <th className="px-3 py-2.5">Plan</th>
                        <th className="px-3 py-2.5 hidden sm:table-cell">Lien final</th>
                        <th className="px-3 py-2.5 hidden sm:table-cell">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, idx) => (
                        <tr
                          key={idx}
                          onClick={() => setSelectedResult(result)}
                          className={`table-row-hover cursor-pointer ${selectedResult?.batchIndex === result.batchIndex ? "row-selected" : ""}`}
                          style={{ borderBottom: "1px solid var(--border-subtle)" }}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs" style={{ color: "var(--text-subtle)" }}>{result.batchIndex}</td>
                          <td className="px-3 py-2.5">
                            <span className={result.isValid ? "badge-valid" : "badge-invalid"}>
                              {result.isValid ? "Valide" : "Invalide"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text)" }}>{result.accountInfo?.plan || result.accountInfo?.plan_label || "-"}</td>
                          <td className="px-3 py-2.5 text-xs truncate max-w-[200px] hidden sm:table-cell" style={{ color: "var(--text-subtle)" }}>{result.accountInfo?.final_url || "-"}</td>
                          <td className="px-3 py-2.5 text-xs hidden sm:table-cell" style={{ color: "var(--text-subtle)" }}>{result.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {selectedResult && (
            <div className="border-t lg:hidden overflow-y-auto max-h-[55vh]" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>Détail #{selectedResult.batchIndex}</span>
                <button onClick={() => setSelectedResult(null)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-muted)", background: "var(--bg-surface-alt)" }}>✕ Fermer</button>
              </div>
              <PrimeDetails result={selectedResult} />
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
        <aside className="hidden lg:flex lg:flex-col w-[420px] border-l overflow-y-auto" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          {selectedResult ? (
            <PrimeDetails result={selectedResult} />
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

function PrimeDetails({ result }: { result: any }) {
  return (
    <div className="p-4 space-y-4 sm:p-5 sm:space-y-5">
      {/* Status */}
      <div className={result.isValid ? "detail-valid" : "detail-invalid"}>
        <p className={`text-sm font-medium ${result.isValid ? "detail-valid-text" : "detail-invalid-text"}`}>
          {result.isValid ? "Cookie Valide" : "Cookie Invalide"}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{result.message}</p>
      </div>

      {/* Final URL */}
      {result.accountInfo?.final_url && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>URL finale</h3>
          <p className="text-xs font-mono rounded-lg p-3 border break-all" style={{ color: "var(--text-muted)", background: "var(--bg)", borderColor: "var(--border)" }}>
            {result.accountInfo.final_url}
          </p>
        </section>
      )}

      {/* Profiles */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>Profils</h3>
        <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          <div>Nombre : <span style={{ color: "var(--text)" }}>{result.accountInfo?.profile_count ?? 0}</span></div>
          <div>Actif : <span style={{ color: "var(--text)" }}>{result.accountInfo?.active_profile_name || "-"}</span></div>
          {result.accountInfo?.profile_names?.length > 0 && (
            <div style={{ color: "var(--text)" }}>{result.accountInfo.profile_names.join(", ")}</div>
          )}
        </div>
      </section>

      {/* Cookies */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-subtle)" }}>Cookies (Netscape)</h3>
          <button onClick={() => copyText(result.netscapeFormat || "")} className="text-[11px] transition-colors hover:opacity-70" style={{ color: "var(--text-muted)" }}>
            Copier
          </button>
        </div>
        <pre className="text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all max-h-[280px] overflow-auto" style={{ color: "var(--text-subtle)", background: "var(--bg)", borderColor: "var(--border)" }}>
          {result.netscapeFormat || "-"}
        </pre>
      </section>

      {/* Account info */}
      {result.accountInfo && Object.keys(result.accountInfo).length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>Détails</h3>
          <pre className="text-xs rounded-lg p-3 border whitespace-pre-wrap break-all overflow-auto max-h-[300px]" style={{ color: "var(--text-muted)", background: "var(--bg)", borderColor: "var(--border)" }}>
            {JSON.stringify(result.accountInfo, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
