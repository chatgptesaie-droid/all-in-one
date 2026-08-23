import { useEffect, useState } from "react";
import * as validator from "../lib/scribd.validator";
import type { ScribdResult } from "../lib/scribd.validator";

export function meta() { return [{ title: "Scribd Cookies Validator" }]; }

export default function ScribdPage() {
	const [cookieText, setCookieText] = useState("");
	const [results, setResults] = useState<ScribdResult[]>([]);
	const [selected, setSelected] = useState<ScribdResult | null>(null);
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState(0);
	const [total, setTotal] = useState(0);
	const [status, setStatus] = useState("Prêt");

	useEffect(() => validator.subscribe((event) => {
		if (event.type === "snapshot") { setResults(event.results || []); setRunning(!!event.running); setProgress(event.progress || 0); setTotal(event.total || 0); setStatus(event.statusMessage || "Prêt"); }
		if (event.type === "start") setRunning(true);
		if (event.type === "init") setTotal(event.total || 0);
		if (event.type === "result") { setResults((current) => [...current, event.data]); setProgress(event.progress || 0); }
		if (event.type === "done") { setRunning(false); setStatus(`Terminé - ${event.valid} valides, ${event.invalid} invalides`); }
		if (event.type === "error") setStatus(`Erreur: ${event.message}`);
		if (event.type === "stop" || event.type === "stopped") setRunning(false);
	}), []);

	const validCount = results.filter((result) => result.isValid).length;
	const start = () => { if (!cookieText.trim()) { setStatus("Aucun cookie à tester"); return; } setResults([]); setSelected(null); setProgress(0); void validator.startValidation(cookieText); };
	const reset = () => { validator.stopValidation(); setCookieText(""); setResults([]); setSelected(null); setProgress(0); setTotal(0); setStatus("Prêt"); };
	const loadFile = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void file.text().then(setCookieText); };
	const exportValid = () => { const valid = results.filter((result) => result.isValid); const url = URL.createObjectURL(new Blob([valid.map((result) => result.netscapeFormat).join("\n\n")], { type: "text/plain" })); const link = document.createElement("a"); link.href = url; link.download = "scribd_valid_cookies.txt"; link.click(); URL.revokeObjectURL(url); };

	return <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>
		<header className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Scribd Cookies Validator</h1><p className="mt-1 text-sm">Validation Selenium et informations du compte</p></div><span className="text-xs">{running ? "Validation en cours..." : status}</span></div></header>
		<div className="flex flex-1 overflow-hidden min-h-0"><main className="flex-1 flex flex-col overflow-hidden min-w-0">
			<div className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><div className="flex flex-wrap gap-3 items-center"><label className="btn-secondary">Charger fichier<input type="file" accept=".txt" className="hidden" onChange={loadFile} disabled={running} /></label><button className="btn-primary" onClick={start} disabled={running || !cookieText.trim()}>{running ? "Validation..." : "Lancer la validation"}</button><button className="btn-secondary" onClick={reset} disabled={running}>Reset</button>{running && <button className="btn-danger" onClick={() => validator.stopValidation()}>Arrêter</button>}{validCount > 0 && !running && <button className="btn-secondary" onClick={exportValid}>Export TXT</button>}</div>{running && <div className="mt-3"><div className="flex justify-between text-xs mb-1"><span>{results.length} / {total} traités</span><span>{progress}%</span></div><div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${progress}%` }} /></div></div>}</div>
			{results.length === 0 && !running && <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}><label className="block text-xs font-semibold mb-2 uppercase tracking-wide">Cookies Scribd au format Netscape</label><textarea value={cookieText} onChange={(event) => setCookieText(event.target.value)} className="textarea-surface" placeholder=".scribd.com\tTRUE\t/\tTRUE\t0\tnom\tvaleur..." /></div>}
			<div className="flex-1 overflow-auto p-4 sm:px-6">{results.length > 0 && <div className="overflow-x-auto rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}><table className="min-w-[700px] w-full text-sm"><thead><tr className="text-left text-xs border-b" style={{ borderColor: "var(--border)" }}><th className="px-3 py-2">#</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Nom</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">URL finale</th></tr></thead><tbody>{results.map((result) => <tr key={result.batchIndex} onClick={() => setSelected(result)} className="table-row-hover cursor-pointer" style={{ borderBottom: "1px solid var(--border-subtle)" }}><td className="px-3 py-2">{result.batchIndex}</td><td className="px-3 py-2"><span className={result.isValid ? "badge-valid" : "badge-invalid"}>{result.isValid ? "Valide" : "Invalide"}</span></td><td className="px-3 py-2 text-xs">{result.accountInfo?.email || "-"}</td><td className="px-3 py-2 text-xs">{result.accountInfo?.full_name || "-"}</td><td className="px-3 py-2 text-xs">{result.accountInfo?.plan_type || result.accountInfo?.plan_tier || "-"}</td><td className="px-3 py-2 text-xs max-w-[220px] truncate">{result.accountInfo?.final_url || "-"}</td></tr>)}</tbody></table></div>}</div>
			{results.length > 0 && <footer className="shrink-0 border-t px-4 py-2.5 text-xs" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>Total: <b>{results.length}</b> · Valides: <b className="text-emerald-500">{validCount}</b> · Invalides: <b className="text-red-400">{results.length - validCount}</b></footer>}
		</main><aside className="hidden lg:block w-[400px] border-l overflow-y-auto p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>{selected ? <><div className={selected.isValid ? "detail-valid" : "detail-invalid"}><b>{selected.isValid ? "Cookie valide" : "Cookie invalide"}</b><p className="text-xs mt-1">{selected.message}</p></div><pre className="mt-4 text-xs whitespace-pre-wrap break-all">{JSON.stringify(selected.accountInfo, null, 2)}</pre></> : <div className="text-sm text-center mt-10">Sélectionnez un résultat</div>}</aside></div>
	</div>;
}
