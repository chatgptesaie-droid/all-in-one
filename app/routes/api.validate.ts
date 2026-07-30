/**
 * API Route pour la validation des cookies Netflix
 * Streaming NDJSON pour envoyer les resultats en temps reel
 */

import {
  parseCookiesFromText,
  validateCookieBatch,
  translatePlan,
} from "~/lib/netflix.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { cookies: cookieText } = await request.json();

  if (!cookieText || typeof cookieText !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun cookie fourni" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const batches = parseCookiesFromText(cookieText);

  if (batches.length === 0) {
    return new Response(
      JSON.stringify({
        type: "error",
        message: "Aucun cookie valide trouve dans le texte",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(
        encoder.encode(
          JSON.stringify({ type: "init", total: batches.length }) + "\n"
        )
      );

      let validCount = 0;
      let invalidCount = 0;

      for (let i = 0; i < batches.length; i++) {
        if (request.signal.aborted) break;

        try {
          const result = await validateCookieBatch(batches[i]);

          // Translate plan name if present
          if (result.accountInfo?.planName) {
            result.accountInfo.planName = translatePlan(
              result.accountInfo.planName as string
            );
          }

          if (result.isValid) {
            validCount++;
          } else {
            invalidCount++;
          }

          const progress = Math.round(((i + 1) / batches.length) * 100);

          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "result", data: result, progress }) + "\n"
            )
          );
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
                progress: Math.round(((i + 1) / batches.length) * 100),
              }) + "\n"
            )
          );
          invalidCount++;
        }

        // Delai pour eviter le rate limiting Netflix
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "done",
            total: batches.length,
            valid: validCount,
            invalid: invalidCount,
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
