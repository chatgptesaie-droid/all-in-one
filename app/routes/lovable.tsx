import { useCallback, useEffect, useState } from "react";
import * as validator from "../lib/lovable.validator";
import type { LovableResult } from "../lib/lovable.validator";

function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function copyCookie(cookieText: string) {
  if (typeof navigator !== "undefined")
    void navigator.clipboard?.writeText(cookieText);
}

type StorageEntry = {
  id: string | null;
  name: string;
  metadata?: Record<string, unknown> | null;
};

export function meta() {
  return [
    { title: "Lovable Cookies Validator" },
    { name: "description", content: "Vérification et inspection des cookies Lovable" },
  ];
}

export default function LovablePage() {
  const [cookieText, setCookieText] = useState("");
  const [results, setResults] = useState<LovableResult[]>([]);
  const [selected, setSelected] = useState<LovableResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("Prêt");
  const [fileLoaded, setFileLoaded] = useState<string | null>(null);
  const [useOnlineFiles, setUseOnlineFiles] = useState(false);
  const [storageFiles, setStorageFiles] = useState<StorageEntry[]>([]);
  const [currentStorageFolder, setCurrentStorageFolder] = useState("");
  const [selectedStoragePath, setSelectedStoragePath] = useState("");
  const [selectedStorageIsFolder, setSelectedStorageIsFolder] = useState(false);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "NETCOOKIES";

  const fetchStorageFiles = useCallback(async (folderPath = currentStorageFolder) => {
    setIsLoadingStorage(true);
    setStorageError(null);
    try {
      const response = await fetch("/api/storage/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: STORAGE_BUCKET, path: folderPath }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible de lister les fichiers");
      const list = Array.isArray(payload.data) ? payload.data : [];
      setStorageFiles(list);
      const first = list[0];
      setSelectedStoragePath(first?.name || first?.id || "");
      setSelectedStorageIsFolder(first?.id === null && first?.metadata == null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Erreur de stockage en ligne");
    } finally {
      setIsLoadingStorage(false);
    }
  }, [STORAGE_BUCKET, currentStorageFolder]);

  const listStorageEntries = useCallback(async (folderPath: string): Promise<StorageEntry[]> => {
    const response = await fetch("/api/storage/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket: STORAGE_BUCKET, path: folderPath, limit: 1000, offset: 0 }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Impossible de lister les fichiers");
    return Array.isArray(payload.data) ? payload.data : [];
  }, [STORAGE_BUCKET]);

  const collectFolderFiles = useCallback(async (folderPath: string): Promise<Array<{ name: string; path: string }>> => {
    const files: Array<{ name: string; path: string }> = [];
    for (const entry of await listStorageEntries(folderPath)) {
      const name = entry.name || entry.id;
      if (!name) continue;
      const path = `${folderPath}${name}`;
      if (entry.id === null && entry.metadata == null) {
        files.push(...await collectFolderFiles(path.endsWith("/") ? path : `${path}/`));
      } else {
        files.push({ name, path });
      }
    }
    return files;
  }, [listStorageEntries]);

  const loadStorageFile = useCallback(async () => {
    if (!selectedStoragePath) return setStorageError("Sélectionnez un fichier en ligne");

    const selectedItem = storageFiles.find((item) => item.name === selectedStoragePath);
    const isFolder = selectedItem ? selectedItem.id === null && selectedItem.metadata == null : selectedStorageIsFolder;

    setIsLoadingStorage(true);
    setStorageError(null);

    try {
      if (isFolder) {
        const folder = `${currentStorageFolder}${selectedStoragePath}`.replace(/\\/g, "/");
        const files = await collectFolderFiles(folder.endsWith("/") ? folder : `${folder}/`);
        const contents = await Promise.all(files.map(async (file) => {
          const response = await fetch("/api/storage/content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bucket: STORAGE_BUCKET, path: file.path }),
          });
          if (!response.ok) throw new Error(`Impossible de charger ${file.path}`);
          return `# --- ${file.name} ---\n${await response.text()}`;
        }));
        setCookieText(contents.join("\n\n"));
        setFileLoaded(folder);
        setStatus(`${files.length} fichiers en ligne chargés`);
      } else {
        const path = `${currentStorageFolder}${selectedStoragePath}`;
        const response = await fetch("/api/storage/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: STORAGE_BUCKET, path }),
        });
        if (!response.ok) throw new Error("Impossible de charger le fichier en ligne");
        setCookieText(await response.text());
        setFileLoaded(path);
        setStatus("Fichier en ligne chargé");
      }
      setResults([]);
      setSelected(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Erreur de chargement en ligne");
    } finally {
      setIsLoadingStorage(false);
    }
  }, [STORAGE_BUCKET, collectFolderFiles, currentStorageFolder, selectedStorageIsFolder, selectedStoragePath, storageFiles]);

  const handleUseOnlineFilesChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setUseOnlineFiles(enabled);
    if (enabled) {
      setCurrentStorageFolder("");
      setSelectedStoragePath("");
      await fetchStorageFiles("");
    }
  }, [fetchStorageFiles]);

  useEffect(
    () =>
      validator.subscribe((event) => {
        if (event.type === "snapshot") {
          setResults(event.results || []);
          setRunning(!!event.running);
          setProgress(event.progress || 0);
          setTotal(event.total || 0);
          setStatus(event.statusMessage || "Prêt");
        }
        if (event.type === "start") setRunning(true);
        if (event.type === "init") setTotal(event.total || 0);
        if (event.type === "result") {
          setResults((current) => [...current, event.data]);
          setProgress(event.progress || 0);
        }
        if (event.type === "done") {
          setRunning(false);
          setStatus(`Terminé - ${event.valid} valides, ${event.invalid} invalides`);
        }
        if (event.type === "error") setStatus(`Erreur: ${event.message}`);
        if (event.type === "stop" || event.type === "stopped") setRunning(false);
      }),
    [],
  );

  const loadFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    void Promise.all(files.map((file) => file.text())).then((contents) => {
      const merged = contents
        .map((content, index) => `# --- ${files[index].name} ---\n${content}`)
        .join("\n\n");
      setCookieText(merged);
      setFileLoaded(files.length === 1 ? files[0].name : `${files.length} fichiers`);
      setResults([]);
      setSelected(null);
      setStatus("Fichier chargé");
    });
  }, []);

  const start = () => {
    if (!cookieText.trim()) {
      setStatus("Aucun cookie à tester");
      return;
    }
    setResults([]);
    setSelected(null);
    setProgress(0);
    void validator.startValidation(cookieText);
  };

  const reset = () => {
    validator.stopValidation();
    setCookieText("");
    setResults([]);
    setSelected(null);
    setProgress(0);
    setTotal(0);
    setFileLoaded(null);
    setStatus("Prêt");
  };

  const valid = results.filter((result) => result.isValid);

  const exportResults = (json: boolean) => {
    if (!valid.length) return;
    download(
      json
        ? JSON.stringify({ exportTime: new Date().toISOString(), results: valid }, null, 2)
        : `# Netscape HTTP Cookie File\n\n${valid.map((result) => result.netscapeFormat).join("\n\n")}`,
      json ? "application/json" : "text/plain",
      `lovable_valid_cookies.${json ? "json" : "txt"}`,
    );
  };

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <header
        className="shrink-0 border-b px-4 py-3 sm:px-6"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Lovable Cookies Validator</h1>
            <p className="mt-1 text-sm">Validation du compte, du workspace et du plan</p>
          </div>
          <span className="text-xs">{running ? "Validation en cours..." : status}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div
            className="shrink-0 border-b px-4 py-3 sm:px-6"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border)",
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="btn-secondary w-full sm:w-auto">
                Charger fichier
                <input type="file" accept=".txt,.json" className="hidden" onChange={loadFiles} disabled={running || useOnlineFiles} />
              </label>
              <label className="btn-secondary w-full sm:w-auto">
                Charger dossier
                <input
                  type="file"
                  accept=".txt,.json"
                  multiple
                  className="hidden"
                  onChange={loadFiles}
                  disabled={running || useOnlineFiles}
                  {...({ webkitdirectory: "", directory: "" } as any)}
                />
              </label>
              <label htmlFor="use-online-files" className="switch-control w-full sm:w-auto text-sm" style={{ color: "var(--text)" }}>
                <span className={`toggle-switch ${useOnlineFiles ? "toggle-switch--active" : ""}`} aria-hidden="true">
                  <span className={`toggle-switch__thumb ${useOnlineFiles ? "toggle-switch__thumb--active" : ""}`} />
                </span>
                <input
                  id="use-online-files"
                  type="checkbox"
                  checked={useOnlineFiles}
                  onChange={handleUseOnlineFilesChange}
                  className="sr-only"
                />
                <span className="font-medium">Utiliser fichiers en ligne</span>
              </label>
              <button className="btn-primary w-full sm:w-auto" onClick={start} disabled={running || !cookieText.trim()}>
                {running ? "Validation..." : "Lancer la validation"}
              </button>
              <button className="btn-secondary w-full sm:w-auto" onClick={reset} disabled={running}>
                Reset
              </button>
              {running && (
                <button className="btn-danger w-full sm:w-auto" onClick={() => validator.stopValidation()}>
                  Arrêter
                </button>
              )}
              {valid.length > 0 && !running && (
                <>
                  <button className="btn-secondary w-full sm:w-auto" onClick={() => exportResults(false)}>
                    Export TXT
                  </button>
                  <button className="btn-secondary w-full sm:w-auto" onClick={() => exportResults(true)}>
                    Export JSON
                  </button>
                </>
              )}
              {fileLoaded && (
                <span className="text-xs sm:ml-auto" style={{ color: "var(--text-subtle)" }}>
                  {fileLoaded}
                </span>
              )}
            </div>

            {running && (
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span>
                    {results.length} / {total} traités
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}>
                  <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>

          {useOnlineFiles && (
            <div
              className="shrink-0 border-b px-4 py-3 sm:px-6"
              style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm" style={{ color: "var(--text)" }}>
                  Fichiers en ligne
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {isLoadingStorage ? "Chargement des fichiers..." : `${storageFiles.length} élément(s) disponible(s)`}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={selectedStoragePath}
                    onChange={(event) => {
                      const value = event.target.value;
                      const item = storageFiles.find((entry) => entry.name === value);
                      setSelectedStoragePath(value);
                      setSelectedStorageIsFolder(item?.id === null && item?.metadata == null);
                    }}
                    className="select-surface min-w-[220px]"
                    disabled={isLoadingStorage || storageFiles.length === 0}
                  >
                    {storageFiles.map((file) => (
                      <option key={file.id ?? file.name} value={file.name}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => void loadStorageFile()} disabled={isLoadingStorage || !selectedStoragePath} className="btn-primary w-full sm:w-auto">
                    {isLoadingStorage ? "Chargement..." : "Charger les données"}
                  </button>
                </div>
              </div>
              {storageError && <p className="mt-3 text-sm text-red-400">{storageError}</p>}
            </div>
          )}

          {results.length === 0 && !running && (
            <div
              className="shrink-0 border-b px-4 py-4 sm:px-6"
              style={{
                background: "var(--bg-surface-alt)",
                borderColor: "var(--border)",
              }}
            >
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide">Cookies Lovable au format Netscape</label>
              <textarea
                value={cookieText}
                onChange={(event) => setCookieText(event.target.value)}
                placeholder=".lovable.dev\tTRUE\t/\tTRUE\t0\tlovable-workspace-id\tuser:workspace..."
                className="textarea-surface"
              />
            </div>
          )}

          <div className="flex-1 overflow-auto p-4 sm:px-6">
            {results.length > 0 && (
              <div className="overflow-x-auto rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
                <table className="min-w-[850px] w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider border-b" style={{ color: "var(--text-subtle)", borderColor: "var(--border)" }}>
                      <th className="px-3 py-2.5">#</th>
                      <th className="px-3 py-2.5">Statut</th>
                      <th className="px-3 py-2.5">Nom</th>
                      <th className="px-3 py-2.5">Email</th>
                      <th className="px-3 py-2.5">Workspace</th>
                      <th className="px-3 py-2.5">Plan</th>
                      <th className="px-3 py-2.5">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr
                        key={result.batchIndex}
                        onClick={() => setSelected(result)}
                        className="table-row-hover cursor-pointer"
                        style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      >
                        <td className="px-3 py-2.5">{result.batchIndex}</td>
                        <td className="px-3 py-2.5">
                          <span className={result.isValid ? "badge-valid" : "badge-invalid"}>
                            {result.isValid ? "Valide" : "Invalide"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{result.accountInfo?.name || "-"}</td>
                        <td className="px-3 py-2.5 text-xs">{result.accountInfo?.email || "-"}</td>
                        <td className="px-3 py-2.5 text-xs">{result.accountInfo?.workspace_id || "-"}</td>
                        <td className="px-3 py-2.5 text-xs">{result.accountInfo?.plan || "-"}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-subtle)" }}>
                          {result.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {results.length > 0 && (
            <footer
              className="shrink-0 border-t px-4 py-2.5 text-xs"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              Total: <b>{results.length}</b> · Valides: <b className="text-emerald-500">{valid.length}</b> · Invalides: <b className="text-red-400">{results.length - valid.length}</b>
            </footer>
          )}
        </main>
        <aside
          className="hidden lg:flex lg:flex-col w-[400px] border-l overflow-y-auto p-4"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}
        >
          {selected ? (
            <>
              <div
                className={selected.isValid ? "detail-valid" : "detail-invalid"}
              >
                <p className="text-sm font-medium">
                  {selected.isValid ? "Cookie valide" : "Cookie invalide"}
                </p>
                <p className="text-xs mt-1">{selected.message}</p>
              </div>
              <div className="flex items-center justify-between mt-4 mb-2">
                <h3 className="text-[11px] uppercase tracking-wider">
                  Cookie Netscape
                </h3>
                <button className="text-xs" onClick={() => copyCookie(selected.netscapeFormat)}>
                  Copier
                </button>
              </div>
              <pre
                className="text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all max-h-48 overflow-auto"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {selected.netscapeFormat}
              </pre>
              <h3 className="text-[11px] uppercase tracking-wider mt-4 mb-2">
                Informations
              </h3>
              <pre className="text-xs whitespace-pre-wrap break-all">
                {JSON.stringify(selected.accountInfo, null, 2)}
              </pre>
            </>
          ) : (
            <div
              className="flex items-center justify-center h-full text-sm"
              style={{ color: "var(--text-subtle)" }}
            >
              Sélectionnez un résultat
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
