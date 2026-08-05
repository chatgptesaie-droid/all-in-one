import { useEffect, useMemo, useState } from "react";

export function meta() {
  return [
    { title: "Netflix Cookie Results" },
    { name: "description", content: "Liste des cookies valides et filtrage par plan" },
  ];
}

interface ValidationResult {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: Array<{ name: string; value: string }>;
  accountInfo: Record<string, any>;
  netscapeFormat: string;
}

export default function Results() {
  const [validResults, setValidResults] = useState<ValidationResult[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("netflix-validator-valid-results");
      if (saved) {
        const parsed = JSON.parse(saved) as ValidationResult[];
        setValidResults(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setValidResults([]);
    }

    // subscribe to updates so Results shows live results
    import("../lib/validator").then((mod) => {
      const unsub = mod.subscribe((event: any) => {
        if (event.type === "snapshot") {
          setValidResults((event.results || []).filter((r: any) => r.isValid));
        } else if (event.type === "result") {
          // append only if valid
          if (event.data?.isValid) {
            setValidResults((prev) => [...prev, event.data]);
          }
        }
      });
      // cleanup
      return () => unsub();
    });
  }, []);

  const planOptions = useMemo(() => {
    const plans = new Set<string>();
    for (const result of validResults) {
      const plan = result.accountInfo?.planName || "Unknown";
      plans.add(plan || "Unknown");
    }
    return ["all", ...Array.from(plans).sort()];
  }, [validResults]);

  const filteredResults = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return validResults.filter((result) => {
      const matchesPlan =
        selectedPlan === "all" ||
        (result.accountInfo?.planName || "Unknown") === selectedPlan;
      const profileName = (result.accountInfo?.profileName || "").toString();
      const matchesProfile = normalizedSearch
        ? profileName.toLowerCase().includes(normalizedSearch)
        : true;
      return matchesPlan && matchesProfile;
    });
  }, [validResults, selectedPlan, searchQuery]);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <section className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold" style={{ color: "var(--text)" }}>Results</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Liste des cookies valides chargees depuis la validation.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-sm" style={{ color: "var(--text-muted)" }}>Filtrer par plan :</label>
              <select
                value={selectedPlan}
                onChange={(event) => setSelectedPlan(event.target.value)}
                className="select-surface"
              >
                {planOptions.map((plan) => (
                  <option key={plan} value={plan}>
                    {plan === "all" ? "Tous les plans" : plan}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-sm" style={{ color: "var(--text-muted)" }}>Recherche profil :</label>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Nom de profil..."
                className="input-surface"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          {filteredResults.length === 0 ? (
            <div className="rounded-2xl border p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}>
              <p>Aucun cookie valide trouve. Lancez une validation depuis la page Netflix.</p>
            </div>
          ) : (
            filteredResults.map((result) => (
              <article
                key={result.batchIndex}
                className="rounded-xl border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
              >
                <div className="w-10 text-xs font-mono" style={{ color: "var(--text-muted)" }}>#{result.batchIndex}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{result.accountInfo?.profileName || result.accountInfo?.planName || "Utilisateur"}</div>
                      <div className="text-xs break-words" style={{ color: "var(--text-muted)" }}>{result.accountInfo?.planName || "Plan inconnu"} • {result.accountInfo?.countryOfSignup || "--"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(result.netscapeFormat)}
                        className="btn-secondary w-full text-xs sm:w-auto"
                      >
                        Copier
                      </button>
                    </div>
                  </div>
                  <div className="text-xs mt-1 break-words" style={{ color: "var(--text-muted)" }}>{result.message}</div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
