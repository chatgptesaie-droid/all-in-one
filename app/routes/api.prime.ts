import { parsePrimeCookiesFromText, validatePrimeBatch } from "~/lib/prime.server";

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

  const batches = parsePrimeCookiesFromText(cookieText);

  if (batches.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun cookie valide trouve dans le texte" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const totalBatches = batches.length;
  const startIndex = Number.isFinite(start) ? Math.max(0, Math.min(start, totalBatches)) : 0;
  const chunkSize = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
  const endIndex = Math.min(totalBatches, startIndex + chunkSize);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(JSON.stringify({ type: "init", total: totalBatches }) + "\n"));

      let validCount = 0;
      let invalidCount = 0;

      if (startIndex >= totalBatches) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "done",
              total: totalBatches,
              valid: validCount,
              invalid: invalidCount,
              nextStart: totalBatches,
              finished: true,
            }) + "\n"
          )
        );
        controller.close();
        return;
      }

      for (let i = startIndex; i < endIndex; i++) {
        if (request.signal.aborted) break;

        try {
          const result = await validatePrimeBatch(batches[i]);
          if (result.isValid) validCount++; else invalidCount++;

          const progress = Math.round(((i + 1) / totalBatches) * 100);
          controller.enqueue(encoder.encode(JSON.stringify({ type: "result", data: result, progress }) + "\n"));
        } catch (error) {
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
          invalidCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 600));
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
