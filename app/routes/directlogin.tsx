import { useState, useCallback } from "react";

interface DirectLoginResult {
  index: number;
  url: string;
  isValid: boolean;
  finalUrl: string;
  status: number | null;
  message: string;
  profileNames?: string[];
  accountInfo?: Record<string, string | number | boolean | string[]>;
}

export function meta() {
  return [
    { title: "Direct Login Netflix" },
    { name: "description", content: "Tester des liens Netflix et vérifier la redirection vers /account." },
  ];
}

export default function DirectLoginPage() {
  const [urlText, setUrlText] = useState("");
  const [results, setResults] = useState<DirectLoginResult[]>([]);
  const [statusMessage, setStatusMessage] = useState("Pret");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);

  const handleSubmit = useCallback(async () => {
    if (!urlText.trim()) {
      setStatusMessage("Aucun lien a tester");
      return;
    }

    setIsLoading(true);
    setStatusMessage("Test en cours...");
    setResults([]);
    setProgress(0);
    setTotalCount(0);
    setValidCount(0);
    setInvalidCount(0);

    try {
      const response = await fetch("/api/directlogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlText }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || `Erreur serveur: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Stream non disponible");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);
            if (event.type === "init") {
              setTotalCount(event.total || 0);
            } else if (event.type === "result") {
              setResults((prev) => [...prev, event.data]);
              setProgress(event.progress || 0);
              if (event.data?.isValid) {
                setValidCount((prev) => prev + 1);
              } else {
                setInvalidCount((prev) => prev + 1);
              }
            } else if (event.type === "done") {
              setStatusMessage(`Termine - ${event.valid} valides, ${event.invalid} invalides`);
              setProgress(100);
            }
          } catch {
            // ignore bad lines
          }
        }
      }
    } catch (error) {
      setStatusMessage(`Erreur: ${error instanceof Error ? error.message : "Inconnue"}`);
    } finally {
      setIsLoading(false);
    }
  }, [urlText]);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <section className="max-w-6xl mx-auto px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold" style={{ color: "var(--text)" }}>Direct Login Netflix</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Collez vos liens, puis testez si chaque lien redirige vers <span className="font-semibold">https://www.netflix.com/account</span>.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading}
              className="btn-primary w-full sm:w-auto"
            >
              {isLoading ? "Test en cours..." : "Tester les liens"}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <label className="text-sm font-medium mb-2 block" style={{ color: "var(--text)" }}>Liens Netflix</label>
          <textarea
            value={urlText}
            onChange={(event) => setUrlText(event.target.value)}
            rows={10}
            placeholder="https://www.netflix.com/directlogin?....\nhttps://www.netflix.com/..."
            className="textarea-surface"
          />
          <p className="mt-2 text-xs" style={{ color: "var(--text-subtle)" }}>Un lien par ligne, les lignes vides et les commentaires (#) sont ignorés.</p>
        </div>

        <div className="mt-6 rounded-2xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <div className="grid gap-3 sm:grid-cols-4 sm:items-center">
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Statut</div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>{statusMessage}</div>
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Total</div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>{totalCount}</div>
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Valid</div>
              <div className="text-sm text-emerald-500 font-medium">{validCount}</div>
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Invalide</div>
              <div className="text-sm text-red-400 font-medium">{invalidCount}</div>
            </div>
          </div>
          {isLoading && (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}>
                <span>{results.length} / {totalCount} traités</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full rounded-full h-1.5" style={{ background: "var(--border)" }}>
                <div className="bg-red-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 overflow-x-auto">
          {results.length === 0 ? (
            <div className="rounded-2xl border p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Aucun résultat pour le moment.
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result) => (
                <div
                  key={result.index}
                  className="rounded-2xl border p-4"
                  style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Lien #{result.index}</div>
                      <div className="text-xs break-all" style={{ color: "var(--text-muted)" }}>{result.url}</div>
                    </div>
                    <div className={result.isValid ? "badge-valid" : "badge-invalid"}>
                      {result.isValid ? "Valide" : "Invalide"}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: "var(--text)" }}>Status:</span> {result.status ?? "-"}
                    </div>
                    <div className="text-xs break-all" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: "var(--text)" }}>Final URL:</span> {result.finalUrl || "-"}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: "var(--text)" }}>Message:</span> {result.message}
                    </div>
                  </div>
                  {result.profileNames && result.profileNames.length > 0 && (
                    <div className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: "var(--text)" }}>Profils:</span> {result.profileNames.join(", ")}
                    </div>
                  )}
                  {result.accountInfo && Object.keys(result.accountInfo).length > 0 && (
                    <div className="mt-3 rounded-2xl border p-3 text-xs" style={{ background: "var(--bg-surface-alt)", borderColor: "var(--border)", color: "var(--text-muted)" }}>
                      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--text)" }}>Infos compte</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(result.accountInfo).map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2">
                            <span className="font-medium" style={{ color: "var(--text)" }}>{key}:</span>
                            <span className="break-all">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
