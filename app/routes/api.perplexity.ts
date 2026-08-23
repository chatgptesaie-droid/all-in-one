import { parsePerplexityCookiesFromText, validatePerplexityBatch } from "~/lib/perplexity.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await request.json() as { cookies?: unknown; start?: unknown; limit?: unknown };
  const cookieText = typeof body.cookies === "string" ? body.cookies : "";
  if (!cookieText.trim()) return Response.json({ type: "error", message: "Aucun cookie fourni" }, { status: 400 });

  const batches = parsePerplexityCookiesFromText(cookieText);
  if (!batches.length) return Response.json({ type: "error", message: "Aucun cookie valide trouve" }, { status: 400 });

  const startValue = typeof body.start === "number" && Number.isFinite(body.start) ? body.start : 0;
  // limit = nombre de threads (1–3 envoyé par le validator)
  const limitValue = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 1;
  const start = Math.max(0, Math.min(startValue, batches.length));
  const threads = Math.max(1, Math.min(limitValue, 3)); // cap à 3 Chrome max
  const end = Math.min(batches.length, start + threads);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));

      send({ type: "init", total: batches.length });

      let valid = 0;
      let invalid = 0;

      for (let i = start; i < end; i += threads) {
        if (request.signal.aborted) break;

        // Lancer `threads` validations en parallèle
        const chunk = batches.slice(i, Math.min(i + threads, end));
        const results = await Promise.all(chunk.map((batch) => validatePerplexityBatch(batch)));

        for (const result of results) {
          result.isValid ? valid++ : invalid++;
          send({
            type: "result",
            data: result,
            progress: Math.round(((result.batchIndex) / batches.length) * 100),
          });
        }
      }

      send({ type: "done", valid, invalid, nextStart: end, finished: end >= batches.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
