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
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 p-6">
      <div className="max-w-7xl mx-auto lg:pr-[440px]">
        <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Prime Video Cookie Checker</h1>
          <p className="text-sm text-gray-500">Détection Free/Premium via la page d’accueil Prime Video</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <label className="btn-secondary">
            Charger fichier
            <input type="file" accept=".txt,.json" className="hidden" onChange={handleFileUpload} disabled={isValidating} />
          </label>
          <label className="btn-secondary">
            Charger dossier
            <input type="file" accept=".txt" multiple className="hidden" onChange={handleMultipleFiles} disabled={isValidating} {...({ webkitdirectory: "", directory: "" } as any)} />
          </label>
          <button onClick={start} disabled={isValidating || !cookieText.trim()} className="btn-primary">{isValidating ? "Validation..." : "Lancer la validation"}</button>
          {isValidating && <button onClick={stop} className="btn-danger">Arrêter</button>}
          <span className="text-sm text-gray-500 self-center">{statusMessage}</span>
          {fileLoaded && <span className="text-xs text-gray-500">{fileLoaded}</span>}
        </div>

        <textarea value={cookieText} onChange={(e) => setCookieText(e.target.value)} className="w-full h-40 bg-[#16161e] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 font-mono" placeholder="Pastez vos cookies Netscape ici" />

        {isValidating && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{results.length} / {totalBatches} traités</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div className="bg-amber-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Lien final</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <tr key={idx} onClick={() => setSelectedResult(result)} className="border-b border-gray-800/50 cursor-pointer hover:bg-[#12121a]">
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{result.batchIndex}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${result.isValid ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-red-950/60 text-red-400 border border-red-800/50'}`}>{result.isValid ? 'Valide' : 'Invalide'}</span></td>
                    <td className="px-3 py-2 text-gray-300">{result.accountInfo?.plan || result.accountInfo?.plan_label || '-'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs break-all">{result.accountInfo?.final_url || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{result.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        </div>

        <aside className="hidden lg:block w-[420px] bg-[#111118] border-l border-gray-800 overflow-y-auto fixed right-0 top-0 bottom-0 px-4 py-6">
          {selectedResult ? (
            <div className="rounded-lg border border-gray-800 bg-[#111118] p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Résultat</p>
                  <button onClick={() => copyText(selectedResult.netscapeFormat || "") } className="text-[11px] text-gray-500 hover:text-gray-300">Copier</button>
                </div>
                <div className="text-xs text-gray-300 break-all">{selectedResult.accountInfo?.final_url || '-'}</div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Cookies (Netscape)</p>
                  <button onClick={() => copyText(selectedResult.netscapeFormat || "") } className="text-[11px] text-gray-500 hover:text-gray-300">Copier</button>
                </div>
                <pre className="text-[11px] text-gray-500 font-mono bg-[#0a0a0f] rounded-lg p-3 border border-gray-800 whitespace-pre-wrap break-all max-h-[320px] overflow-auto">{selectedResult.netscapeFormat || '-'}</pre>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Profils</p>
                <div className="text-xs text-gray-300 space-y-1">
                  <div>Nombre : {selectedResult.accountInfo?.profile_count ?? 0}</div>
                  <div>Actif : {selectedResult.accountInfo?.active_profile_name || '-'}</div>
                  <div>{selectedResult.accountInfo?.profile_names?.length ? selectedResult.accountInfo.profile_names.join(", ") : '-'}</div>
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Détails</p>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap">{JSON.stringify(selectedResult, null, 2)}</pre>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-[#111118] p-4 text-sm text-gray-500">Sélectionnez un résultat pour voir les cookies Netscape et le lien final.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
