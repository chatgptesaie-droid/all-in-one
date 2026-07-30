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
    <main className="min-h-screen bg-[#0a0a0f] text-gray-200">
      <section className="max-w-6xl mx-auto px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-white">Direct Login Netflix</h1>
            <p className="mt-2 text-sm text-gray-400">
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
          <label className="text-sm font-medium text-gray-300 mb-2 block">Liens Netflix</label>
          <textarea
            value={urlText}
            onChange={(event) => setUrlText(event.target.value)}
            rows={10}
            placeholder="https://www.netflix.com/directlogin?....\nhttps://www.netflix.com/..."
            className="w-full rounded-2xl border border-gray-800 bg-[#111118] p-4 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-red-500"
          />
          <p className="mt-2 text-xs text-gray-500">Un lien par ligne, les lignes vides et les commentaires (#) sont ignorés.</p>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-800 bg-[#111118] p-4">
          <div className="grid gap-3 sm:grid-cols-4 sm:items-center">
            <div>
              <div className="text-sm text-gray-300">Statut</div>
              <div className="text-sm text-gray-400">{statusMessage}</div>
            </div>
            <div>
              <div className="text-sm text-gray-300">Total</div>
              <div className="text-sm text-gray-400">{totalCount}</div>
            </div>
            <div>
              <div className="text-sm text-gray-300">Valid</div>
              <div className="text-sm text-emerald-300">{validCount}</div>
            </div>
            <div>
              <div className="text-sm text-gray-300">Invalide</div>
              <div className="text-sm text-red-300">{invalidCount}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          {results.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-[#111118] p-6 text-gray-400">
              Aucun résultat pour le moment.
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result) => (
                <div
                  key={result.index}
                  className="rounded-2xl border border-gray-800 bg-[#111118] p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">Lien #{result.index}</div>
                      <div className="text-xs text-gray-400 break-all">{result.url}</div>
                    </div>
                    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${result.isValid ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
                      {result.isValid ? "Valide" : "Invalide"}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="text-xs text-gray-400">
                      <span className="text-gray-200">Status:</span> {result.status ?? "-"}
                    </div>
                    <div className="text-xs text-gray-400 break-all">
                      <span className="text-gray-200">Final URL:</span> {result.finalUrl || "-"}
                    </div>
                    <div className="text-xs text-gray-400">
                      <span className="text-gray-200">Message:</span> {result.message}
                    </div>
                  </div>
                  {result.profileNames && result.profileNames.length > 0 && (
                    <div className="mt-3 text-xs text-gray-300">
                      <span className="text-gray-200">Profils:</span> {result.profileNames.join(", ")}
                    </div>
                  )}
                  {result.accountInfo && Object.keys(result.accountInfo).length > 0 && (
                    <div className="mt-3 rounded-2xl border border-gray-700 bg-[#12121a] p-3 text-xs text-gray-300">
                      <div className="mb-2 text-sm font-semibold text-white">Infos compte</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(result.accountInfo).map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2">
                            <span className="font-medium text-gray-200">{key}:</span>
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
