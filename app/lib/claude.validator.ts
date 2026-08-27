import { fetchValidationChunk } from "./validation-client";

type Event = { type: string; [key: string]: any };
export type ClaudeResult = { batchIndex: number; isValid: boolean; message: string; netflixId: string | null; cookiesData: any[]; accountInfo: Record<string, any>; netscapeFormat: string };
let controller: AbortController | null = null;
let state = { results: [] as ClaudeResult[], total: 0, progress: 0, statusMessage: "Pret", running: false };
const subscribers = new Set<(event: Event) => void>();
function notify(event: Event) { subscribers.forEach((subscriber) => { try { subscriber(event); } catch {} }); }
export function subscribe(subscriber: (event: Event) => void) { subscribers.add(subscriber); subscriber({ type: "snapshot", ...state }); return () => { subscribers.delete(subscriber); }; }
export async function startValidation(cookieText: string) { stopValidation(); controller = new AbortController(); state = { results: [], total: 0, progress: 0, statusMessage: "Validation en cours...", running: true }; notify({ type: "start" }); try { let start = 0; let finished = false; const limit = 3; while (!finished && !controller.signal.aborted) { await fetchValidationChunk("/api/claude", cookieText, start, limit, controller.signal, (event) => { if (event.type === "init") { state.total = event.total || 0; notify(event); } else if (event.type === "result") { state.results.push(event.data); state.progress = event.progress || state.progress; notify(event); } else if (event.type === "done") { start = event.nextStart ?? start + limit; finished = event.finished === true; if (finished) { state.statusMessage = `Termine - ${event.valid} valides, ${event.invalid} invalides`; notify(event); } } }); } } catch (error) { if ((error as Error).name !== "AbortError") notify({ type: "error", message: (error as Error).message }); } state.running = false; controller = null; notify({ type: "stopped" }); }
export function stopValidation() { controller?.abort(); controller = null; if (state.running) { state.running = false; state.statusMessage = "Validation arretee"; notify({ type: "stop" }); } }
