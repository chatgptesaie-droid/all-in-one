import { parseClaudeCookiesFromText, validateClaudeBatch } from "~/lib/claude.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json() as { cookies?: unknown; start?: unknown; limit?: unknown };
  const text = typeof body.cookies === "string" ? body.cookies : "";
  if (!text.trim()) return Response.json({ type: "error", message: "Aucun cookie fourni" }, { status: 400 });
  const batches = parseClaudeCookiesFromText(text);
  if (!batches.length) return Response.json({ type: "error", message: "Aucun cookie Claude valide trouve" }, { status: 400 });
  const startValue = typeof body.start === "number" && Number.isFinite(body.start) ? body.start : 0;
  const limitValue = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 3;
  const start = Math.max(0, Math.min(startValue, batches.length));
  const end = Math.min(batches.length, start + Math.max(1, Math.min(limitValue, 3)));
  const stream = new ReadableStream({ async start(controller) { const encoder = new TextEncoder(); const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); send({ type: "init", total: batches.length }); let valid = 0; let invalid = 0; for (let index = start; index < end; index++) { if (request.signal.aborted) break; const result = await validateClaudeBatch(batches[index]); result.isValid ? valid++ : invalid++; send({ type: "result", data: result, progress: Math.round(((index + 1) / batches.length) * 100) }); } send({ type: "done", valid, invalid, nextStart: end, finished: end >= batches.length }); controller.close(); } });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
