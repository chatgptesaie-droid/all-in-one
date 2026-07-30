import { useState, useCallback, useEffect, useRef } from "react";
import * as validator from "../lib/spotify.validator";

type CookieEntry = {
  domain: string;
  flag: string;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
};

type ValidationResult = {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: CookieEntry[];
  accountInfo: Record<string, any>;
  netscapeFormat: string;
};

export default function SpotifyPage() {
  const [cookieText, setCookieText] = useState("");
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [selectedResult, setSelectedResult] = useState<ValidationResult | null>(null);
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Pret");


  const start = useCallback(() => {
    if (!cookieText.trim()) return;
    setResults([]);
    setSelectedResult(null);
    setProgress(0);
    validator.startValidation(cookieText);
  }, [cookieText]);

  const stop = useCallback(() => {
    validator.stopValidation();
    setIsValidating(false);
  }, []);

  // file upload handlers
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

  // subscribe to validator
  useEffect(() => {
    const unsub = validator.subscribe((event) => {
      if (event.type === 'snapshot') {
        setResults(event.results || []);
        setIsValidating(!!event.running);
        setProgress(event.progress || 0);
        setTotalBatches(event.total || 0);
      } else if (event.type === 'init') {
        setTotalBatches(event.total || 0);
        setStatusMessage('Validation démarree');
      } else if (event.type === 'result') {
        setResults((prev) => [...prev, event.data]);
        setProgress(event.progress || 0);
      } else if (event.type === 'done') {
        setIsValidating(false);
        setStatusMessage(`Termine - ${event.valid} valides, ${event.invalid} invalides`);
      } else if (event.type === 'error') {
        setStatusMessage(`Erreur: ${event.message}`);
        setIsValidating(false);
      } else if (event.type === 'start') {
        setIsValidating(true);
        setStatusMessage('Validation en cours...');
      } else if (event.type === 'stop' || event.type === 'stopped') {
        setIsValidating(false);
        setStatusMessage('Validation arretée');
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 flex flex-col overflow-x-hidden">
      {/* Header - reuse simple header */}
      <header className="bg-[#111118] border-b border-gray-800 px-4 py-4 shrink-0 z-10 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">Spotify Cookie Validator</h1>
            <p className="text-xs text-gray-500 mt-0.5">Validation et extraction de donnees</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden min-h-0 lg:flex-row">
        {/* Main content - left */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 lg:pr-100">
          {/* Toolbar - fixed */}
          <div className="bg-[#111118] border-b border-gray-800 px-4 py-3 shrink-0 z-10 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center max-w-7xl mx-auto">
              <label className="btn-secondary w-full sm:w-auto">
                Charger fichier
                <input type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} disabled={isValidating} />
              </label>
              <label className="btn-secondary w-full sm:w-auto">
                Charger dossier
                <input type="file" accept=".txt" multiple className="hidden" onChange={handleMultipleFiles} disabled={isValidating} {...({ webkitdirectory: "", directory: "" } as any)} />
              </label>
              <div className="hidden h-6 w-px bg-gray-700 sm:mx-1 sm:block" />
              <button onClick={start} disabled={isValidating || !cookieText.trim()} className="btn-primary w-full sm:w-auto">
                {isValidating ? "Validation..." : "Lancer la validation"}
              </button>

              {isValidating && (
                <button onClick={stop} className="btn-danger w-full sm:w-auto">Arreter</button>
              )}

              <span className="text-xs text-gray-400 sm:ml-auto">{statusMessage}</span>
            </div>
          </div>

          {/* Input area */}
          <div className="p-4 shrink-0 max-w-7xl mx-auto w-full sm:p-6">
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Cookies (format Netscape ou texte brut)</label>
            <textarea value={cookieText} onChange={(e) => setCookieText(e.target.value)} placeholder={`sp_dc\tTRUE\t/\tTRUE\t0\tsp_dc\tvaleur...\nsp_key\tTRUE\t/\tTRUE\t0\tsp_key\tvaleur...`} className="w-full h-44 bg-[#16161e] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 font-mono resize-y focus:outline-none focus:border-gray-600 placeholder:text-gray-700" />
          </div>

          {/* Results table - scrollable */}
          <div className="flex-1 overflow-auto min-h-0">
            {results.length > 0 && (
              <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-[#0a0a0f] z-5">
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                        <th className="px-3 py-2.5 w-10">#</th>
                        <th className="px-3 py-2.5 w-20">Statut</th>
                        <th className="px-3 py-2.5">Profil / Email</th>
                        <th className="px-3 py-2.5">Plan</th>
                        <th className="px-3 py-2.5">Pays</th>
                        <th className="px-3 py-2.5">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr key={result.batchIndex} onClick={() => setSelectedResult(result)} className={`border-b border-gray-800/50 cursor-pointer ${selectedResult?.batchIndex === result.batchIndex ? 'bg-[#11121a]' : 'hover:bg-[#0f0f14]'}`}>
                          <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{result.batchIndex}</td>
                          <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${result.isValid ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-red-950/60 text-red-400 border border-red-800/50'}`}><span className={`w-1.5 h-1.5 rounded-full ${result.isValid ? 'bg-emerald-400' : 'bg-red-400'}`} />{result.isValid ? 'Valide' : 'Invalide'}</span></td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">{(result.accountInfo?.display_name as string) || (result.accountInfo?.email as string) || '-'}</td>
                          <td className="px-3 py-2.5 text-gray-300 text-xs">{(result.accountInfo?.plan as string) || (result.accountInfo?.planName as string) || '-'}</td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{result.accountInfo?.country || '-'}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-50">{result.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Stats footer - fixed */}
          {results.length > 0 && (
            <div className="bg-[#111118] border-t border-gray-800 px-4 py-2.5 shrink-0 z-10 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-xs max-w-7xl mx-auto sm:gap-6">
                <span className="text-gray-500">Total: <span className="text-gray-300 font-medium">{results.length}</span></span>
                <span className="text-gray-500">Valides: <span className="text-emerald-400 font-medium">{results.filter(r=>r.isValid).length}</span></span>
                <span className="text-gray-500">Invalides: <span className="text-red-400 font-medium">{results.filter(r=>!r.isValid).length}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Details (fixed) */}
        <aside className="hidden lg:block w-100 bg-[#111118] border-l border-gray-800 overflow-y-auto fixed right-0 top-0 bottom-0 pt-18.25">
          {selectedResult ? (
            <div className="p-5 space-y-5">
              <div className={`p-3 rounded-lg border ${selectedResult.isValid ? 'bg-emerald-950/30 border-emerald-800/40' : 'bg-red-950/30 border-red-800/40'}`}>
                <p className={`text-sm font-medium ${selectedResult.isValid ? 'text-emerald-400' : 'text-red-400'}`}>{selectedResult.isValid ? 'Cookie Valide' : 'Cookie Invalide'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{selectedResult.message}</p>
              </div>

              {selectedResult.accountInfo && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-3">Informations du compte</h3>
                  <pre className="text-xs text-gray-300 bg-[#0b0b0b] p-3 rounded">{JSON.stringify(selectedResult.accountInfo, null, 2)}</pre>
                </section>
              )}

              <section>
                <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-2">Cookies (Netscape)</h3>
                <pre className="text-[11px] text-gray-500 font-mono bg-[#0a0a0f] rounded-lg p-3 border border-gray-800 whitespace-pre-wrap break-all">{selectedResult.netscapeFormat}</pre>
              </section>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full"><p className="text-sm text-gray-600">Selectionnez un resultat</p></div>
          )}
        </aside>

        {selectedResult && (
          <div className="border-t border-gray-800 bg-[#111118] lg:hidden">
            <div className="p-4 sm:p-5">
              <div className={`p-3 rounded-lg border ${selectedResult.isValid ? 'bg-emerald-950/30 border-emerald-800/40' : 'bg-red-950/30 border-red-800/40'}`}>
                <p className={`text-sm font-medium ${selectedResult.isValid ? 'text-emerald-400' : 'text-red-400'}`}>{selectedResult.isValid ? 'Cookie Valide' : 'Cookie Invalide'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{selectedResult.message}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
