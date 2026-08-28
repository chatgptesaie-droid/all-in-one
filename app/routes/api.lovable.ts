import { parseLovableCookiesFromText, validateLovableBatch } from "~/lib/lovable.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as {
    cookies?: string;
    start?: number;
    limit?: number;
  };

  const cookieText = body.cookies;
  const start = typeof body.start === "number" && Number.isFinite(body.start) ? body.start : 0;
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 50;

  if (!cookieText || typeof cookieText !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun cookie fourni" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const batches = parseLovableCookiesFromText(cookieText);

  if (batches.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun cookie Lovable valide détecté" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const totalBatches = batches.length;
  const startIndex = Math.max(0, Math.min(start, totalBatches));
  const chunkSize = Math.max(1, Math.min(limit, 100));
  const endIndex = Math.min(totalBatches, startIndex + chunkSize);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(JSON.stringify({ type: "init", total: totalBatches }) + "\n"));

      let validCount = 0;
      let invalidCount = 0;

      for (let i = startIndex; i < endIndex; i++) {
        if (request.signal.aborted) break;

        try {
          const result = await validateLovableBatch(batches[i]);
          if (result.isValid) validCount += 1; else invalidCount += 1;
          controller.enqueue(encoder.encode(JSON.stringify({ type: "result", data: result, progress: Math.round(((i + 1) / totalBatches) * 100) }) + "\n"));
        } catch (error) {
          invalidCount += 1;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "result",
                data: {
                  batchIndex: batches[i].index,
                  isValid: false,
                  message: `Erreur: ${error instanceof Error ? error.message : "Inconnue"}`,
                  netflixId: null,
                  cookiesData: batches[i].cookies,
                  accountInfo: {},
                  netscapeFormat: "",
                },
                progress: Math.round(((i + 1) / totalBatches) * 100),
              }) + "\n"
            )
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "done",
            total: totalBatches,
            valid: validCount,
            invalid: invalidCount,
            nextStart: endIndex,
            finished: endIndex >= totalBatches,
          }) + "\n"
        )
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
