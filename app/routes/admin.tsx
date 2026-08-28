import { useEffect, useRef, useState } from "react";

type LogEntry = { id: number; text: string; kind: "info" | "success" | "error" };
type StorageEntry = { name: string; id: string | null; metadata: Record<string, unknown> | null };
type RelativeFile = File & { webkitRelativePath?: string };

const filePath = (file: File) => (file as RelativeFile).webkitRelativePath || file.name;

function encodeFile(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const log = (text: string, kind: LogEntry["kind"] = "info") => setLogs((items) => [...items, { id: Date.now() + Math.random(), text, kind }]);
  const entryPath = (entry: StorageEntry) => currentPath ? `${currentPath}/${entry.name}` : entry.name;

  async function refresh(path = currentPath) {
    const response = await fetch(`/api/admin/files?path=${encodeURIComponent(path)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { log(data.error || "Lecture impossible", "error"); return; }
    setEntries((data.data || []).filter((entry: StorageEntry) => entry.name !== ".keep"));
    setCurrentPath(path);
    setSelectedPaths([]);
  }

  useEffect(() => {
    fetch("/api/admin/login").then((response) => response.json()).then((data: { authenticated?: boolean; configured?: boolean }) => {
      setAuthenticated(data.authenticated === true); setConfigured(data.configured !== false);
      if (data.authenticated) void refresh("");
    }).catch(() => log("Impossible de contacter le serveur", "error"));
  }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { log(data.error || "Connexion impossible", "error"); return; }
    setPassword(""); setAuthenticated(true); void refresh("");
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setLogs([]); let count = 0;
    for (const file of files) {
      const relative = filePath(file).replaceAll("\\", "/").replace(/^\/+/, "");
      const path = currentPath ? `${currentPath}/${relative}` : relative;
      log(`Envoi de ${path}...`);
      try {
        const response = await fetch("/api/storage/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, fileBase64: encodeFile(new Uint8Array(await file.arrayBuffer())), contentType: file.type || "application/octet-stream", upsert: true }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        count += 1; log(`${path}: envoyé`, "success");
      } catch (error) { log(`${path}: ${error instanceof Error ? error.message : "erreur inconnue"}`, "error"); }
    }
    log(`Terminé: ${count}/${files.length}`, count === files.length ? "success" : "error"); setBusy(false); await refresh(currentPath);
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  async function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const name = newFolder.trim().replace(/^\/+|\/+$/g, "");
    if (!name || name.includes("..") || busy) return;
    setBusy(true); const path = currentPath ? `${currentPath}/${name}` : name;
    const response = await fetch("/api/admin/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "create-folder", path }) });
    const data = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { log(data.error || "Création impossible", "error"); return; }
    setNewFolder(""); log(`${path}/: dossier créé`, "success"); await refresh(currentPath);
  }

  async function renameEntry(entry: StorageEntry) {
    const oldPath = entryPath(entry); const name = window.prompt("Nouveau nom", entry.name)?.trim();
    if (!name || name === entry.name || name.includes("/") || name.includes("..")) return;
    const newPath = currentPath ? `${currentPath}/${name}` : name;
    setBusy(true); const response = await fetch("/api/admin/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "rename", path: oldPath, newPath }) });
    const data = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { log(data.error || "Renommage impossible", "error"); return; }
    log(`${oldPath} -> ${newPath}: renommé`, "success"); await refresh(currentPath);
  }

  async function deleteSelected(paths: string[]) {
    if (!paths.length || busy) return;
    if (!window.confirm(`Supprimer ${paths.length} élément${paths.length > 1 ? "s" : ""} sélectionné${paths.length > 1 ? "s" : ""} ?`)) return;
    setBusy(true);
    const response = await fetch("/api/admin/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "bulk-delete", paths }) });
    const data = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { log(data.error || "Suppression impossible", "error"); return; }
    log(`${paths.length} élément${paths.length > 1 ? "s" : ""} supprimé${paths.length > 1 ? "s" : ""}`, "success"); await refresh(currentPath);
  }

  async function readFile(entry: StorageEntry) {
    const path = entryPath(entry); const response = await fetch("/api/storage/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    if (!response.ok) { log(`${path}: lecture impossible`, "error"); return; }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = entry.name; link.click(); URL.revokeObjectURL(url); log(`${path}: téléchargé`, "success");
  }

  async function logout() { await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) }); setAuthenticated(false); setLogs([]); }

  if (!authenticated) return <main className="mx-auto flex min-h-[calc(100vh-72px)] max-w-md items-center px-4 py-10"><form onSubmit={login} className="panel-surface w-full space-y-5 p-6"><p className="text-xs font-semibold uppercase tracking-widest text-red-400">NetCookies</p><h1 className="text-2xl font-bold">Administration</h1>{!configured && <p className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-300">Configure ADMIN_PASSWORD côté serveur.</p>}<input className="input-surface" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe admin" required /><button className="btn-primary w-full" disabled={busy || !configured}>{busy ? "Connexion..." : "Se connecter"}</button>{logs.map((item) => <p key={item.id} className="text-sm text-red-400">{item.text}</p>)}</form></main>;

  const allSelected = entries.length > 0 && entries.every((entry) => selectedPaths.includes(entryPath(entry)));
  return <main className="mx-auto grid min-h-[calc(100vh-72px)] max-w-6xl gap-5 px-4 py-6 sm:grid-cols-[250px_minmax(0,1fr)] sm:px-6"><aside className="panel-surface h-fit space-y-4 p-4 sm:sticky sm:top-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-red-400">Espace privé</p><h1 className="mt-2 text-xl font-bold">Gestionnaire</h1></div><label className="btn-primary w-full cursor-pointer justify-center"><span>Envoyer un fichier</span><input ref={fileInput} type="file" className="hidden" onChange={(event) => uploadFiles(Array.from(event.target.files || []))} disabled={busy} /></label><label className="btn-secondary w-full cursor-pointer justify-center"><span>Envoyer un dossier</span><input ref={folderInput} type="file" className="hidden" onChange={(event) => uploadFiles(Array.from(event.target.files || []))} disabled={busy} {...({ webkitdirectory: "", directory: "" } as any)} /></label><form onSubmit={createFolder} className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border)" }}><input className="input-surface" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Nom du dossier" /><button className="btn-secondary w-full" disabled={busy || !newFolder.trim()}>Nouveau dossier</button></form>{selectedPaths.length > 0 && <button type="button" className="btn-danger w-full" onClick={() => deleteSelected(selectedPaths)} disabled={busy}>Supprimer {selectedPaths.length} sélectionné{selectedPaths.length > 1 ? "s" : ""}</button>}<button type="button" className="btn-secondary w-full" onClick={logout}>Déconnexion</button><div className="border-t pt-4" style={{ borderColor: "var(--border)" }}><h2 className="mb-2 text-sm font-semibold">Logs</h2><div className="max-h-64 overflow-auto rounded-xl border p-3 font-mono text-xs" style={{ background: "var(--input-bg)", borderColor: "var(--border)" }}>{logs.length ? logs.map((item) => <p key={item.id} className={item.kind === "success" ? "text-emerald-400" : item.kind === "error" ? "text-red-400" : "text-slate-400"}>{item.text}</p>) : <p style={{ color: "var(--text-subtle)" }}>Aucun envoi.</p>}</div></div></aside><section className="panel-surface min-w-0 overflow-hidden"><div className="flex flex-wrap items-center gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}><button type="button" className="btn-secondary" onClick={() => refresh("")} disabled={!currentPath || busy}>Racine</button>{currentPath && <button type="button" className="btn-secondary" onClick={() => refresh(currentPath.split("/").slice(0, -1).join("/"))} disabled={busy}>Retour</button>}<span className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>{currentPath ? `/${currentPath}/` : "/"}</span><label className="ml-auto flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedPaths(event.target.checked ? entries.map(entryPath) : [])} disabled={!entries.length || busy} /> Tout sélectionner</label><button type="button" className="btn-secondary" onClick={() => refresh()} disabled={busy}>Actualiser</button></div><div className="divide-y" style={{ borderColor: "var(--border)" }}>{entries.length === 0 ? <p className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>Aucun fichier ou dossier ici.</p> : entries.map((entry) => { const path = entryPath(entry); const folder = entry.id === null && entry.metadata === null; const checked = selectedPaths.includes(path); return <div key={entry.name} className="group flex items-center gap-3 p-4"><input type="checkbox" aria-label={`Sélectionner ${entry.name}`} checked={checked} onChange={() => setSelectedPaths((paths) => checked ? paths.filter((item) => item !== path) : [...paths, path])} disabled={busy} className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" /><span className="text-lg">{folder ? "📁" : "📄"}</span><button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => folder ? refresh(path) : readFile(entry)}>{entry.name}</button><button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => renameEntry(entry)} disabled={busy}>Renommer</button>{!folder && <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => readFile(entry)} disabled={busy}>Lire</button>}<button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={() => deleteSelected([path])} disabled={busy}>Supprimer</button></div>; })}</div></section></main>;
}
