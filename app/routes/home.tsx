import { useState, useCallback, useEffect } from "react";
import * as validator from "../lib/validator";
import type { Route } from "./+types/home";
import { FaTelegramPlane } from "react-icons/fa";
export function meta({ }: Route.MetaArgs) {
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
  const [useOnlineFiles, setUseOnlineFiles] = useState(false);
  const [storageFiles, setStorageFiles] = useState<Array<{
    id: string | null;
    name: string;
    updated_at?: string;
    metadata?: Record<string, unknown> | null;
  }>>([]);
  const [currentStorageFolder, setCurrentStorageFolder] = useState("");
  const [selectedStoragePath, setSelectedStoragePath] = useState("");
  const [selectedStorageIsFolder, setSelectedStorageIsFolder] = useState(false);
  const [storageFolderFileCount, setStorageFolderFileCount] = useState(0);
  const [storageFolderLoadedCount, setStorageFolderLoadedCount] = useState(0);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

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
        if (useOnlineFiles && selectedStoragePath) {
          saveValidationSummary(event.valid, event.invalid);
        }
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

  const STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "NETCOOKIES";

  const fetchStorageFiles = useCallback(async (folderPath?: string) => {
    const path = folderPath ?? currentStorageFolder;
    setIsLoadingStorage(true);
    setStorageError(null);

    try {
      const body: Record<string, string> = { path };
      if (STORAGE_BUCKET) {
        body.bucket = STORAGE_BUCKET;
      }
      const response = await fetch("/api/storage/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Impossible de lister les fichiers");
      }

      const list = Array.isArray(payload.data) ? payload.data : [];
      setStorageFiles(list);
      if (list.length > 0) {
        const firstName = list[0].name || list[0].id || "";
        setSelectedStoragePath(firstName);
        setSelectedStorageIsFolder(list[0].id === null);
      } else {
        setSelectedStoragePath("");
        setSelectedStorageIsFolder(false);
      }
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Erreur de stockage en ligne"
      );
    } finally {
      setIsLoadingStorage(false);
    }
  }, [STORAGE_BUCKET, currentStorageFolder]);

  const saveStorageAccess = useCallback(
    async (path: string) => {
      try {
        await fetch("/api/db/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: "files",
            record: {
              path,
              bucket: STORAGE_BUCKET,
              source: "supabase_load",
              loaded_at: new Date().toISOString(),
            },
          }),
        });
      } catch {
        // ignore database save errors
      }
    },
    [STORAGE_BUCKET]
  );

  const listStorageEntries = useCallback(
    async (folderPath: string) => {
      const allEntries: Array<{ id: string | null; name: string; updated_at?: string; metadata?: Record<string, unknown> | null }> = [];
      let offset = 0;
      while (true) {
        const response = await fetch("/api/storage/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: STORAGE_BUCKET, path: folderPath, limit: 1000, offset }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Impossible de lister les fichiers");
        }

        const list = Array.isArray(payload.data) ? payload.data : [];
        allEntries.push(...list);
        if (list.length < 1000) {
          break;
        }
        offset += list.length;
      }
      return allEntries;
    },
    [STORAGE_BUCKET]
  );

  const collectFolderFiles = useCallback(
    async (folderPath: string) => {
      const entries = await listStorageEntries(folderPath);
      const files: Array<{ name: string; path: string }> = [];

      for (const entry of entries) {
        const entryName = entry.name || entry.id;
        if (!entryName) continue;
        const entryPath = `${folderPath}${entryName}`;
        const isFolder = entry.id === null && entry.metadata == null;
        if (isFolder) {
          const subFolderPath = entryPath.endsWith("/") ? entryPath : `${entryPath}/`;
          const nestedFiles = await collectFolderFiles(subFolderPath);
          files.push(...nestedFiles);
        } else {
          files.push({ name: entryName, path: entryPath });
        }
      }

      return files;
    },
    [listStorageEntries]
  );

  const saveValidationSummary = useCallback(
    async (valid: number, invalid: number) => {
      if (!selectedStoragePath) return;

      try {
        await fetch("/api/db/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: "files",
            record: {
              path: selectedStoragePath,
              bucket: STORAGE_BUCKET,
              source: "validation",
              valid_count: valid,
              invalid_count: invalid,
              validated_at: new Date().toISOString(),
            },
          }),
        });
      } catch {
        // ignore database save errors
      }
    },
    [selectedStoragePath, STORAGE_BUCKET]
  );

  const loadStorageFile = useCallback(async () => {
    if (!selectedStoragePath) {
      setStorageError("Selectionne un fichier en ligne");
      return;
    }

    const selectedItem = storageFiles.find((item) => item.name === selectedStoragePath);
    const isFolder = selectedItem
      ? selectedItem.id === null && selectedItem.metadata == null
      : selectedStorageIsFolder;

    if (isFolder) {
      const folderPath = `${currentStorageFolder}${selectedStoragePath}`.replace(/\\/g, "/");
      const normalizedFolderPath = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;

      setStorageError(null);
      setIsLoadingStorage(true);
      setCookieText("");
      setFileLoaded(normalizedFolderPath);
      setSelectedResult(null);
      setStatusMessage(`Chargement du dossier: ${normalizedFolderPath}`);

      try {
        const files = await collectFolderFiles(normalizedFolderPath);
        if (files.length === 0) {
          throw new Error("Le dossier ne contient aucun fichier");
        }

        setStorageFolderFileCount(files.length);
        setStorageFolderLoadedCount(0);

        let combinedText = "";
        for (const [index, file] of files.entries()) {
          const fileResponse = await fetch("/api/storage/content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bucket: STORAGE_BUCKET, path: file.path }),
          });

          if (!fileResponse.ok) {
            const payload = await fileResponse.json().catch(() => ({}));
            throw new Error(payload.error || `Impossible de charger ${file.path}`);
          }

          const fileText = await fileResponse.text();
          combinedText += `# --- ${file.name} ---\n${fileText}\n\n`;
          setStorageFolderLoadedCount(index + 1);
          setStatusMessage(
            `Chargement du dossier: ${normalizedFolderPath} (${index + 1}/${files.length})`
          );
        }

        setCookieText(combinedText.trim());
        setFileLoaded(normalizedFolderPath);
        setStatusMessage(`Dossier charge: ${normalizedFolderPath}`);
        await saveStorageAccess(normalizedFolderPath);
      } catch (error) {
        setStorageError(
          error instanceof Error ? error.message : "Erreur de chargement en ligne"
        );
      } finally {
        setIsLoadingStorage(false);
        setStorageFolderLoadedCount(0);
      }

      return;
    }

    setStorageError(null);

    try {
      const response = await fetch("/api/storage/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: STORAGE_BUCKET,
          path: `${currentStorageFolder}${selectedStoragePath}`,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Impossible de charger le fichier");
      }

      const text = await response.text();
      setCookieText(text);
      setFileLoaded(`${currentStorageFolder}${selectedStoragePath}`);
      setStatusMessage(`Fichier en ligne charge: ${currentStorageFolder}${selectedStoragePath}`);
      await saveStorageAccess(`${currentStorageFolder}${selectedStoragePath}`);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Erreur de chargement en ligne"
      );
    } finally {
      setIsLoadingStorage(false);
    }
  }, [currentStorageFolder, saveStorageAccess, selectedStorageIsFolder, selectedStoragePath, storageFiles]);

  const handleUseOnlineFilesChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked;
      setUseOnlineFiles(enabled);
      if (enabled) {
        setCurrentStorageFolder("");
        setSelectedStoragePath("");
        setSelectedStorageIsFolder(false);
        await fetchStorageFiles();
      }
    },
    [fetchStorageFiles]
  );

  const resetInput = useCallback(() => {
    setCookieText("");
    setResults([]);
    setSelectedResult(null);
    setFileLoaded(null);
    setStatusMessage("Pret");
    setProgress(0);
    setTotalBatches(0);
  }, []);

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
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* Header */}
      <header
        className="shrink-0 z-20 border-b px-4 py-3 sm:px-6"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1
                className="text-xl font-semibold tracking-tight"
                style={{ color: "var(--text)" }}
              >
                Netflix fucker by
              </h1>

              <a
                href="https://t.me/Antony0206"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                id="telegram-icon"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md transition-transform hover:scale-105 hover:shadow-lg"
              >
                <FaTelegramPlane
                  size={22}
                  className="text-[#0088cc]"

                />
              </a>
            </div>

            <p
              className="mt-1 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Validation et extraction de données
            </p>
          </div>

          <StatusBadge
            message={statusMessage}
            isValidating={isValidating}
          />
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
                <input
                  type="file"
                  accept=".txt,.json"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isValidating || useOnlineFiles}
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
                  disabled={isValidating || useOnlineFiles}
                  {...({ webkitdirectory: "", directory: "" } as any)}
                />
              </label>

              <label
                htmlFor="use-online-files"
                className="switch-control w-full sm:w-auto text-sm"
                style={{ color: "var(--text)" }}
              >
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

              <div className="hidden h-6 w-px sm:mx-1 sm:block" style={{ background: "var(--border)" }} />

              <button
                onClick={startValidation}
                disabled={isValidating || !cookieText.trim()}
                className="btn-primary w-full sm:w-auto"
              >
                {isValidating ? "Validation..." : "Lancer la validation"}
              </button>

              <button
                onClick={resetInput}
                disabled={isValidating && true}
                className="btn-secondary w-full sm:w-auto"
              >
                Reset
              </button>

              {isValidating && (
                <button onClick={stopValidation} className="btn-danger w-full sm:w-auto">
                  Arreter
                </button>
              )}

              {validCount > 0 && !isValidating && (
                <>
                  <div className="hidden h-6 w-px sm:mx-1 sm:block" style={{ background: "var(--border)" }} />
                  <button onClick={exportTxt} className="btn-secondary w-full sm:w-auto">
                    Export TXT
                  </button>
                  <button onClick={exportJSON} className="btn-secondary w-full sm:w-auto">
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

            {/* Progress */}
            {isValidating && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}>
                  <span>
                    {results.length} / {totalBatches} traites
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}>
                  <div
                    className="bg-red-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {useOnlineFiles && (
            <div className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="text-sm" style={{ color: "var(--text)" }}>Fichiers en ligne</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {isLoadingStorage && storageFolderFileCount > 0
                      ? `Chargement ${storageFolderLoadedCount}/${storageFolderFileCount} fichier(s)...`
                      : isLoadingStorage
                        ? "Chargement des fichiers..."
                        : storageFiles.length > 0
                          ? `${storageFiles.length} fichier(s) disponibles`
                          : "Aucun fichier en ligne trouvé."}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={selectedStoragePath}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedStoragePath(value);
                      const selectedItem = storageFiles.find((item) => item.name === value);
                      setSelectedStorageIsFolder(!Boolean(selectedItem?.metadata) || value.endsWith("/"));
                    }}
                    className="select-surface min-w-[220px]"
                    disabled={isLoadingStorage || storageFiles.length === 0}
                  >
                    {storageFiles.map((file) => (
                      <option key={file.id ?? file.name} value={file.name || file.id || ""}>
                        {file.name || file.id}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={loadStorageFile}
                    disabled={isLoadingStorage || !selectedStoragePath}
                    className="btn-primary w-full sm:w-auto"
                  >
                    {isLoadingStorage ? "Chargement..." : "Charger les données"}
                  </button>
                </div>
              </div>
              {storageError && (
                <p className="mt-3 text-sm text-red-400">{storageError}</p>
              )}
            </div>
          )}

          {/* Input area (shown when no results) */}
          {results.length === 0 && !isValidating && (
            <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)" }}>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Cookies (format Netscape ou texte brut)
              </label>
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder={`.netflix.com\tTRUE\t/\tTRUE\t0\tNetflixId\tvaleur...\n.netflix.com\tTRUE\t/\tTRUE\t0\tSecureNetflixId\tvaleur...`}
                className="textarea-surface"
              />
            </div>
          )}

          {/* Results table - scrollable */}
          <div className="flex-1 overflow-auto min-h-0" style={{ background: "var(--bg)" }}>
            {results.length > 0 && (
              <div className="px-4 py-3 sm:px-6">
                <div className="overflow-x-auto rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
                  <table className="min-w-[600px] w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface)" }}>
                      <tr className="text-left text-[11px] uppercase tracking-wider border-b" style={{ color: "var(--text-subtle)", borderColor: "var(--border)" }}>
                        <th className="px-3 py-2.5 w-8">#</th>
                        <th className="px-3 py-2.5 w-20">Statut</th>
                        <th className="px-3 py-2.5">Profil</th>
                        <th className="px-3 py-2.5 hidden sm:table-cell">Plan</th>
                        <th className="px-3 py-2.5 hidden md:table-cell">Pays</th>
                        <th className="px-3 py-2.5 hidden lg:table-cell">Facturation</th>
                        <th className="px-3 py-2.5 hidden xl:table-cell">URL finale</th>
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
                          <td className="px-3 py-2.5 font-mono text-xs" style={{ color: "var(--text-subtle)" }}>
                            {result.batchIndex}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={result.isValid ? "badge-valid" : "badge-invalid"}>
                              <span className={`w-1.5 h-1.5 rounded-full ${result.isValid ? "bg-emerald-400" : "bg-red-400"}`} />
                              {result.isValid ? "Valide" : "Invalide"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text)" }}>
                            {decodeEscapes(result.accountInfo?.profileName || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs hidden sm:table-cell" style={{ color: "var(--text)" }}>
                            {decodeEscapes(result.accountInfo?.planName || result.accountInfo?.plan || result.accountInfo?.plan_label || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs hidden md:table-cell" style={{ color: "var(--text-muted)" }}>
                            {result.accountInfo?.countryOfSignup || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs hidden lg:table-cell" style={{ color: "var(--text-muted)" }}>
                            {decodeEscapes(result.accountInfo?.nextBillingDate || "") || "-"}
                          </td>
                          <td className="px-3 py-2.5 text-xs truncate max-w-[160px] hidden xl:table-cell" style={{ color: "var(--text-subtle)" }}>
                            {(result.accountInfo?.final_url as string) || "-"}
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

          {selectedResult && (
            <div className="border-t lg:hidden overflow-y-auto max-h-[55vh]" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-subtle)" }}>
                  Détail #{selectedResult.batchIndex}
                </span>
                <button
                  onClick={() => setSelectedResult(null)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: "var(--text-muted)", background: "var(--bg-surface-alt)" }}
                >
                  ✕ Fermer
                </button>
              </div>
              <ResultDetails result={selectedResult} />
            </div>
          )}

          {/* Stats footer */}
          {results.length > 0 && (
            <div className="shrink-0 z-10 border-t px-4 py-2.5 sm:px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-3 text-xs sm:gap-6">
                <span style={{ color: "var(--text-muted)" }}>
                  Total:{" "}
                  <span className="font-medium" style={{ color: "var(--text)" }}>
                    {results.length}
                  </span>
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  Valides:{" "}
                  <span className="text-emerald-500 font-medium">
                    {validCount}
                  </span>
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  Invalides:{" "}
                  <span className="text-red-400 font-medium">
                    {invalidCount}
                  </span>
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  Taux:{" "}
                  <span className="font-medium" style={{ color: "var(--text)" }}>
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

        {/* Right panel - Details */}
        <aside className="hidden lg:flex lg:flex-col w-[400px] border-l overflow-y-auto" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          {selectedResult ? (
            <ResultDetails result={selectedResult} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
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
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{message}</span>
    </div>
  );
}

function ResultDetails({ result }: { result: ValidationResult }) {
  const [showFullCookies, setShowFullCookies] = useState(false);
  const info = result.accountInfo;

  return (
    <div className="p-4 space-y-4 sm:p-5 sm:space-y-5">
      {/* Status header */}
      <div className={result.isValid ? "detail-valid" : "detail-invalid"}>
        <p className={`text-sm font-medium ${result.isValid ? "detail-valid-text" : "detail-invalid-text"}`}>
          {result.isValid ? "Cookie Valide" : "Cookie Invalide"}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{result.message}</p>
      </div>

      {/* Final URL */}
      {info?.final_url && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>
            URL finale
          </h3>
          <p className="text-xs font-mono rounded-lg p-3 border break-all" style={{ color: "var(--text-muted)", background: "var(--bg)", borderColor: "var(--border)" }}>
            {info.final_url as string}
          </p>
        </section>
      )}

      {/* NetflixId */}
      {result.netflixId && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-subtle)" }}>
              NetflixId
            </h3>
            <button
              onClick={() => navigator.clipboard.writeText(result.netflixId!)}
              className="text-[11px] transition-colors hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              Copier
            </button>
          </div>
          <pre className="text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all max-h-24 overflow-auto" style={{ color: "var(--text-muted)", background: "var(--bg)", borderColor: "var(--border)" }}>
            {result.netflixId}
          </pre>
        </section>
      )}

      {/* Account info */}
      {result.isValid && Object.keys(info).length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: "var(--text-subtle)" }}>
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
          <h3 className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-subtle)" }}>
            Cookies (Netscape)
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFullCookies(!showFullCookies)}
              className="text-[11px] transition-colors hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              {showFullCookies ? "Reduire" : "Tout afficher"}
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(result.netscapeFormat)}
              className="text-[11px] transition-colors hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              Copier
            </button>
          </div>
        </div>
        <pre
          className={`text-[11px] font-mono rounded-lg p-3 border whitespace-pre-wrap break-all ${showFullCookies ? "" : "max-h-28 overflow-hidden"
            }`}
          style={{ color: "var(--text-subtle)", background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {result.netscapeFormat}
        </pre>
      </section>

      {/* Cookie list */}
      <section>
        <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-subtle)" }}>
          Detail des cookies ({result.cookiesData.length})
        </h3>
        <div className="rounded-lg border divide-y" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          {result.cookiesData.map((cookie, idx) => (
            <div key={idx} className="px-3 py-2 flex items-center gap-3" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[11px] text-amber-500/80 font-medium shrink-0 w-[130px] truncate">
                {cookie.name}
              </span>
              <span className="text-[11px] truncate flex-1" style={{ color: "var(--text-subtle)" }}>
                {cookie.value.length > 60
                  ? cookie.value.substring(0, 60) + "..."
                  : cookie.value}
              </span>
              {cookie.name === "NetflixId" && (
                <button
                  onClick={() => navigator.clipboard.writeText(cookie.value)}
                  className="shrink-0 text-[10px] px-2 py-0.5 rounded transition-colors hover:opacity-80"
                  style={{ color: "var(--text-muted)", background: "var(--bg-surface-alt)", border: "1px solid var(--border)" }}
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
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-xs text-right truncate" style={{ color: "var(--text)" }}>
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
