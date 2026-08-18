import { parseCookiesFromText } from "~/lib/netflix.server";
import type { CookieBatch, CookieEntry } from "~/lib/netflix.server";
import { validateParamountBatch } from "~/lib/paramount.server";

/**
 * Parser spécifique Paramount — supporte deux formats :
 * 1. Netscape standard (une ligne = un cookie)
 * 2. Format "Cookie search results" avec "FILE: path" + lignes indentées
 *    → chaque FILE = un batch
 */
function parseParamountCookies(raw: string): CookieBatch[] {
  // Toujours convertir #HttpOnly_ avant tout parsing
  const preprocessed = raw
    .split("\n")
    .map((line) => line.startsWith("#HttpOnly_") ? line.replace(/^#HttpOnly_/, "") : line)
    .join("\n");

  // Détecter le format "Cookie search results"
  if (preprocessed.includes("Cookie search results") || preprocessed.match(/^FILE:\s/m)) {
    return parseSearchResultFormat(preprocessed);
  }
  // Sinon fallback standard
  return parseCookiesFromText(preprocessed);
}

function parseSearchResultFormat(raw: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const lines = raw.replace(/\r/g, "").split("\n");

  let currentBatchCookies: CookieEntry[] = [];
  let currentFileName = "";

  const flushBatch = () => {
    if (currentBatchCookies.length > 0) {
      batches.push({
        index: batches.length + 1,
        cookies: currentBatchCookies,
        rawLine: currentFileName,
        sourceFile: currentFileName,
      });
      currentBatchCookies = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Nouvelle section de fichier
    if (trimmed.startsWith("FILE:")) {
      flushBatch();
      currentFileName = trimmed.replace(/^FILE:\s*/, "").trim();
      continue;
    }

    // Ligne vide ou commentaire pur (pas de tab → pas un cookie Netscape)
    if (!trimmed || (trimmed.startsWith("#") && !trimmed.includes("\t"))) continue;

    // Ligne cookie Netscape (contient des tabulations)
    if (trimmed.includes("\t")) {
      const parts = trimmed.replace(/^#HttpOnly_/, "").split("\t");
      if (parts.length >= 7) {
        currentBatchCookies.push({
          domain: parts[0],
          flag: parts[1],
          path: parts[2],
          secure: parts[3].toUpperCase() === "TRUE",
          expiry: parts[4],
          name: parts[5],
          value: parts[6],
        });
      }
    }
  }

  flushBatch();
  return batches;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as { cookies?: string; start?: number; limit?: number; use_proxy?: boolean; proxy_url?: string };
  const cookieText = body.cookies;
  const proxyUrl = body.proxy_url || "";
  const start = typeof body.start === "number" && Number.isFinite(body.start) ? body.start : 0;
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 50;

  if (!cookieText || typeof cookieText !== "string") {
    return new Response(JSON.stringify({ type: "error", message: "Aucun cookie fourni" }), { status: 400 });
  }

  const batches = parseParamountCookies(cookieText);

  if (batches.length === 0) {
    return new Response(JSON.stringify({ type: "error", message: "Aucun cookie valide trouvé" }), { status: 400 });
  }

  const totalBatches = batches.length;
  const startIndex = Math.max(0, Math.min(start, totalBatches));
  const chunkSize = Math.max(1, Math.min(limit, 100));
  const endIndex = Math.min(totalBatches, startIndex + chunkSize);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(JSON.stringify({ type: "init", total: totalBatches }) + "\n"));

      let validCount = 0; let invalidCount = 0;

      if (startIndex >= totalBatches) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "done", total: totalBatches, valid: 0, invalid: 0, nextStart: totalBatches, finished: true }) + "\n"));
        controller.close(); return;
      }

      for (let i = startIndex; i < endIndex; i++) {
        if (request.signal.aborted) break;
        try {
          const result = await validateParamountBatch(batches[i], proxyUrl);
          if (result.isValid) validCount++; else invalidCount++;
          const progress = Math.round(((i + 1) / totalBatches) * 100);
          controller.enqueue(enc.encode(JSON.stringify({ type: "result", data: result, progress }) + "\n"));
        } catch (error) {
          invalidCount++;
          controller.enqueue(enc.encode(JSON.stringify({
            type: "result",
            data: { batchIndex: batches[i].index, isValid: false, message: `Erreur: ${error instanceof Error ? error.message : "Inconnue"}`, netflixId: null, cookiesData: batches[i].cookies, accountInfo: {}, netscapeFormat: "" },
            progress: Math.round(((i + 1) / totalBatches) * 100),
          }) + "\n"));
        }
        await new Promise((r) => setTimeout(r, 800));
      }

      controller.enqueue(enc.encode(JSON.stringify({ type: "done", total: totalBatches, valid: validCount, invalid: invalidCount, nextStart: endIndex, finished: endIndex >= totalBatches }) + "\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
