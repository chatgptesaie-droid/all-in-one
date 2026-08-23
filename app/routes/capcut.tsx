import { useCallback, useEffect, useState } from "react";
import * as validator from "../lib/capcut.validator";
import type { CapcutResult } from "../lib/capcut.validator";

export function meta() {
  return [{ title: "CapCut Cookies Validator" }, { name: "description", content: "Validateur de cookies CapCut" }];
}

function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default function CapcutPage() {
  const [cookieText, setCookieText] = useState("");
  const [results, setResults] = useState<CapcutResult[]>([]);
  const [selected, setSelected] = useState<CapcutResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("Pret");
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);

  useEffect(() => validator.subscribe((event) => {
    if (event.type === "snapshot") { setResults(event.results || []); setRunning(!!event.running); setProgress(event.progress || 0); setTotal(event.total || 0); setStatus(event.statusMessage || "Pret"); }
    if (event.type === "start") setRunning(true);
    if (event.type === "init") setTotal(event.total || 0);
    if (event.type === "result") { setResults((current) => [...current, event.data]); setProgress(event.progress || 0); }
    if (event.type === "done") { setStatus(`Termine - ${event.valid} valides, ${event.invalid} invalides`); setRunning(false); }
    if (event.type === "error") setStatus(`Erreur: ${event.message}`);
    if (event.type === "stop" || event.type === "stopped") setRunning(false);
  }), []);

  const loadFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); if (!files.length) return;
    Promise.all(files.map((file) => file.text())).then((contents) => {
      setCookieText(contents.map((content, index) => `# --- ${files[index].name} ---\n${content}`).join("\n\n"));
      setFileLoaded(files.length === 1 ? files[0].name : `${files.length} fichiers`); setResults([]); setSelected(null); setStatus("Fichier charge");
    });
  }, []);

  const start = () => { if (!cookieText.trim()) { setStatus("Aucun cookie a tester"); return; } setResults([]); setSelected(null); setProgress(0); void validator.startValidation(cookieText); };
  const reset = () => { validator.stopValidation(); setCookieText(""); setResults([]); setSelected(null); setProgress(0); setTotal(0); setFileLoaded(null); setStatus("Pret"); };
  const exportResults = (json: boolean) => { const valid = results.filter((result) => result.isValid); if (!valid.length) return; download(json ? JSON.stringify({ exportTime: new Date().toISOString(), cookies: valid }, null, 2) : `# Netscape HTTP Cookie File\n\n${valid.map((result) => result.netscapeFormat).join("\n\n")}`, json ? "application/json" : "text/plain", `capcut_valid_cookies.${json ? "json" : "txt"}`); };
  const validCount = results.filter((result) => result.isValid).length;

  return <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>
    <header className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
          <div><h1 className="text-xl font-semibold">CapCut Cookies Validator</h1><p className="mt-1 text-sm">Validation et extraction des informations de compte</p></div>
          <span className="text-xs">{running ? "Validation en cours..." : status}</span>
      </div>
    </header>
    <div className="flex flex-1 overflow-hidden min-h-0"><main className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="btn-secondary w-full sm:w-auto">Charger fichier<input type="file" accept=".txt,.json" className="hidden" onChange={loadFiles} disabled={running} /></label>
        <label className="btn-secondary w-full sm:w-auto">Charger dossier<input type="file" accept=".txt,.json" multiple className="hidden" onChange={loadFiles} disabled={running} {...({ webkitdirectory: "", directory: "" } as any)} /></label>
        <button onClick={start} disabled={running || !cookieText.trim()} className="btn-primary w-full sm:w-auto">{running ? "Validation..." : "Lancer la validation"}</button>
        <button onClick={reset} disabled={running} className="btn-secondary w-full sm:w-auto">Reset</button>
        {running && <button onClick={() => validator.stopValidation()} className="btn-danger w-full sm:w-auto">Arreter</button>}
        {validCount > 0 && !running && <><button onClick={() => exportResults(false)} className="btn-secondary w-full sm:w-auto">Export TXT</button><button onClick={() => exportResults(true)} className="btn-secondary w-full sm:w-auto">Export JSON</button></>}
        {fileLoaded && <span className="text-xs sm:ml-auto" style={{ color: "var(--text-subtle)" }}>{fileLoaded}</span>}
      </div>{running && <div className="mt-3"><div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}><span>{results.length} / {total} traites</span><span>{progress}%</span></div><div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}><div className="bg-red-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} /></div></div>}</div>
      {results.length === 0 && !running && <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}><label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Cookies CapCut (format Netscape ou texte brut)</label><textarea value={cookieText} onChange={(event) => setCookieText(event.target.value)} placeholder={".capcut.com\tTRUE\t/\tTRUE\t0\tname\tvaleur..."} className="textarea-surface" /></div>}
      <div className="flex-1 overflow-auto p-4 sm:px-6" style={{ background: "var(--bg)" }}>{results.length > 0 && <div className="overflow-x-auto rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><table className="min-w-[560px] w-full text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider border-b" style={{ color: "var(--text-subtle)", borderColor: "var(--border)" }}><th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Statut</th><th className="px-3 py-2.5">Crédit</th><th className="px-3 py-2.5">Abonnement</th><th className="px-3 py-2.5">Message</th></tr></thead><tbody>{results.map((result) => <tr key={result.batchIndex} onClick={() => setSelected(result)} className="table-row-hover cursor-pointer" style={{ borderBottom: "1px solid var(--border-subtle)" }}><td className="px-3 py-2.5 font-mono text-xs">{result.batchIndex}</td><td className="px-3 py-2.5"><span className={result.isValid ? "badge-valid" : "badge-invalid"}>{result.isValid ? "Valide" : "Invalide"}</span></td><td className="px-3 py-2.5 text-xs">{result.accountInfo?.credit?.gift_credit ?? "-"}</td><td className="px-3 py-2.5 text-xs">{result.accountInfo?.workspace_subscribe_info?.flag === undefined ? "-" : String(result.accountInfo.workspace_subscribe_info.flag)}</td><td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-subtle)" }}>{result.message}</td></tr>)}</tbody></table></div>}</div>
      {results.length > 0 && <footer className="shrink-0 border-t px-4 py-2.5 text-xs sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}>Total: <b>{results.length}</b> · Valides: <b className="text-emerald-500">{validCount}</b> · Invalides: <b className="text-red-400">{results.length - validCount}</b></footer>}
    </main><aside className="hidden lg:flex lg:flex-col w-[400px] border-l overflow-y-auto" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>{selected ? <Details result={selected} /> : <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--text-subtle)" }}>Selectionnez un resultat</div>}</aside></div>
  </div>;
}

function Details({ result }: { result: CapcutResult }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="p-4 space-y-4"><div className={result.isValid ? "detail-valid" : "detail-invalid"}><p className="text-sm font-medium">{result.isValid ? "Cookie Valide" : "Cookie Invalide"}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{result.message}</p></div><section><h3 className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--text-subtle)" }}>Informations CapCut</h3><pre className="text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all max-h-64 overflow-auto" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-muted)" }}>{JSON.stringify(result.accountInfo, null, 2)}</pre></section><section><div className="flex justify-between mb-2"><h3 className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>Cookies Netscape</h3><button onClick={() => navigator.clipboard.writeText(result.netscapeFormat)} className="text-[11px]" style={{ color: "var(--text-muted)" }}>Copier</button></div><pre className={`text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all ${expanded ? "" : "max-h-28 overflow-hidden"}`} style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-subtle)" }}>{result.netscapeFormat}</pre><button onClick={() => setExpanded(!expanded)} className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>{expanded ? "Reduire" : "Tout afficher"}</button></section></div>;
}