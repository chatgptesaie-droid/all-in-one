import { fetchValidationChunk } from "./validation-client";

export type PerplexityResult = {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: Array<{ domain: string; flag: string; path: string; secure: boolean; expiry: string; name: string; value: string }>;
  accountInfo: Record<string, any>;
  netscapeFormat: string;
};

let controller: AbortController | null = null;
let subscribers = new Set<(event: { type: string; [key: string]: any }) => void>();
let state = { results: [] as PerplexityResult[], total: 0, progress: 0, statusMessage: "Pret", running: false };

function notify(event: { type: string; [key: string]: any }) {
  subscribers.forEach((sub) => { try { sub(event); } catch {} });
}

export function subscribe(subscriber: (event: { type: string; [key: string]: any }) => void) {
  subscribers.add(subscriber);
  subscriber({ type: "snapshot", ...state });
  return () => { subscribers.delete(subscriber); };
}

export async function startValidation(cookieText: string, threads = 1) {
  stopValidation();
  controller = new AbortController();
  state = { results: [], total: 0, progress: 0, statusMessage: "Validation en cours...", running: true };
  notify({ type: "start" });

  // Chaque "chunk" = threads cookies traités en parallèle côté serveur
  const chunkSize = Math.max(1, Math.min(threads, 3));

  try {
    let start = 0;
    let finished = false;
    while (!finished && !controller.signal.aborted) {
      await fetchValidationChunk(
        "/api/perplexity",
        cookieText,
        start,
        chunkSize,
        controller.signal,
        (event) => {
          if (event.type === "init") {
            state.total = event.total || 0;
            notify(event);
          } else if (event.type === "result") {
            state.results.push(event.data);
            state.progress = event.progress || state.progress;
            notify(event);
          } else if (event.type === "done") {
            start = event.nextStart ?? start + chunkSize;
            finished = event.finished === true;
            if (finished) {
              state.statusMessage = `Termine - ${event.valid} valides, ${event.invalid} invalides`;
              notify(event);
            }
          }
        }
      );
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") notify({ type: "error", message: (error as Error).message });
  }

  state.running = false;
  controller = null;
  notify({ type: "stopped" });
}

export function stopValidation() {
  controller?.abort();
  controller = null;
  if (state.running) {
    state.running = false;
    state.statusMessage = "Validation arretee";
    notify({ type: "stop" });
  }
}
