type CookieEntry = {
  domain: string;
  flag: string;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
};

type AccountInfo = Record<string, any>;

export type ValidationResult = {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: CookieEntry[];
  accountInfo: AccountInfo;
  netscapeFormat: string;
};

type EventCB = (e: { type: string; [k: string]: any }) => void;

let controller: AbortController | null = null;
let subscribers = new Set<EventCB>();
let results: ValidationResult[] = [];
let totalBatches = 0;
let progress = 0;
let statusMessage = "Pret";
let running = false;

function notify(e: { type: string; [k: string]: any }) {
  for (const cb of subscribers) {
    try {
      cb(e);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribe(cb: EventCB) {
  subscribers.add(cb);
  // send current state
  cb({ type: "snapshot", results: [...results], total: totalBatches, progress, statusMessage, running });
  return () => {
    try {
      subscribers.delete(cb);
    } catch {}
  };
}

export function getValidResults() {
  return results.filter((r) => r.isValid);
}

export function getState() {
  return { results: [...results], totalBatches, progress, statusMessage, running };
}

export async function startValidation(cookieText: string) {
  if (running) {
    // already running - stop first
    stopValidation();
  }

  controller = new AbortController();
  running = true;
  results = [];
  totalBatches = 0;
  progress = 0;
  statusMessage = "Validation en cours...";
  notify({ type: "start" });

  try {
    const response = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: cookieText }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Erreur serveur: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Stream non disponible");

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
            totalBatches = event.total || 0;
            notify({ type: "init", total: totalBatches });
          } else if (event.type === "result") {
            results.push(event.data as ValidationResult);
            progress = event.progress ?? progress;
            notify({ type: "result", data: event.data, progress });
          } else if (event.type === "done") {
            statusMessage = `Termine - ${event.valid} valides, ${event.invalid} invalides`;
            running = false;
            notify({ type: "done", valid: event.valid, invalid: event.invalid });
            // persist valid results
            try {
              const valid = getValidResults();
              window.localStorage.setItem("netflix-validator-valid-results", JSON.stringify(valid));
            } catch {}
          } else if (event.type === "error") {
            statusMessage = `Erreur: ${event.message}`;
            notify({ type: "error", message: event.message });
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      statusMessage = `Erreur: ${(err as Error).message}`;
      notify({ type: "error", message: (err as Error).message });
    }
  } finally {
    running = false;
    controller = null;
    notify({ type: "stopped" });
  }
}

export function stopValidation() {
  try {
    controller?.abort();
  } catch {}
  controller = null;
  running = false;
  statusMessage = "Validation arretee";
  notify({ type: "stop" });
}
