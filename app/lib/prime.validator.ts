import { fetchValidationChunk } from "./validation-client";

type EventCB = (e: { type: string; [k: string]: any }) => void;

type CookieEntry = {
  domain: string;
  flag: string;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
};

export type ValidationResult = {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: CookieEntry[];
  accountInfo: Record<string, any>;
  netscapeFormat: string;
};

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
    } catch {}
  }
}

export function subscribe(cb: EventCB) {
  subscribers.add(cb);
  cb({ type: "snapshot", results: [...results], total: totalBatches, progress, statusMessage, running });
  return () => {
    try {
      subscribers.delete(cb);
    } catch {}
  };
}

export async function startValidation(cookieText: string) {
  if (running) stopValidation();

  controller = new AbortController();
  running = true;
  results = [];
  totalBatches = 0;
  progress = 0;
  statusMessage = "Validation en cours...";
  notify({ type: "start" });

  try {
    let start = 0;
    const limit = 20;
    let finished = false;

    while (!finished && controller?.signal.aborted === false) {
      await fetchValidationChunk(
        "/api/prime",
        cookieText,
        start,
        limit,
        controller.signal,
        (event) => {
          if (event.type === "init") {
            totalBatches = event.total || totalBatches;
            notify({ type: "init", total: totalBatches });
          } else if (event.type === "result") {
            results.push(event.data as ValidationResult);
            progress = event.progress ?? progress;
            notify({ type: "result", data: event.data, progress });
          } else if (event.type === "done") {
            start = event.nextStart ?? start + limit;
            finished = event.finished === true;
            if (finished) {
              statusMessage = `Termine - ${event.valid} valides, ${event.invalid} invalides`;
              running = false;
              notify({ type: "done", valid: event.valid, invalid: event.invalid });
            }
          } else if (event.type === "error") {
            statusMessage = `Erreur: ${event.message}`;
            notify({ type: "error", message: event.message });
          }
        }
      );

      if (!finished && controller?.signal.aborted) {
        break;
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
