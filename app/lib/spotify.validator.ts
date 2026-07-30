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
    try { cb(e); } catch {}
  }
}

export function subscribe(cb: EventCB) {
  subscribers.add(cb);
  cb({ type: "snapshot", results: [...results], total: totalBatches, progress, statusMessage, running });
  return () => { try { subscribers.delete(cb); } catch {} };
}

export function getValidResults() {
  return results.filter((r) => r.isValid);
}

export function getState() {
  return { results: [...results], totalBatches, progress, statusMessage, running };
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
    const resp = await fetch('/api/spotify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: cookieText }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `Erreur serveur: ${resp.status}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('Stream non disponible');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'init') {
            totalBatches = event.total || 0;
            notify({ type: 'init', total: totalBatches });
          } else if (event.type === 'result') {
            results.push(event.data as ValidationResult);
            progress = event.progress ?? progress;
            notify({ type: 'result', data: event.data, progress });
          } else if (event.type === 'done') {
            statusMessage = `Termine - ${event.valid} valides, ${event.invalid} invalides`;
            running = false;
            notify({ type: 'done', valid: event.valid, invalid: event.invalid });
            try { window.localStorage.setItem('spotify-validator-valid-results', JSON.stringify(getValidResults())); } catch {}
          } else if (event.type === 'error') {
            statusMessage = `Erreur: ${event.message}`;
            notify({ type: 'error', message: event.message });
          }
        } catch {}
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      statusMessage = `Erreur: ${(err as Error).message}`;
      notify({ type: 'error', message: (err as Error).message });
    }
  } finally {
    running = false;
    controller = null;
    notify({ type: 'stopped' });
  }
}

export function stopValidation() {
  try { controller?.abort(); } catch {}
  controller = null;
  running = false;
  statusMessage = 'Validation arretee';
  notify({ type: 'stop' });
}
