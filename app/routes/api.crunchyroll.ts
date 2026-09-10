import type { CookieBatch, CookieEntry } from "~/lib/netflix.server";
import { parseCookieString, parseCookiesFromText } from "~/lib/netflix.server";
import { validateCrunchyrollBatch } from "~/lib/crunchyroll.server";

function parseCrunchyrollBlock(lines: string[]): CookieEntry[] {
  const cookies: CookieEntry[] = [];
  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
    const normalized = line.startsWith("#HttpOnly_") ? line.slice("#HttpOnly_".length) : line;
    const fields = normalized.split("\t");
    if (fields.length >= 7 && fields[5]) {
      cookies.push({
        domain: fields[0],
        flag: fields[1],
        path: fields[2] || "/",
        secure: fields[3].toUpperCase() === "TRUE",
        expiry: fields[4] || "0",
        name: fields[5],
        value: fields.slice(6).join("\t"),
      });
      continue;
    }
    if (normalized.includes("=") && !normalized.includes("\t")) cookies.push(...parseCookieString(normalized));
  }
  return cookies;
}

function parseCrunchyrollBatches(value: string): CookieBatch[] {
  const lines = value.replace(/\r/g, "").split("\n");
  const marker = /^#\s*---\s*(.+?)\s*---$/;
  const fileMarker = /^FILE:\s*(.+?)\s*$/i;
  const groups: Array<{ name?: string; lines: string[] }> = [];
  let current: { name?: string; lines: string[] } = { lines: [] };
  let hasMarkers = false;
  let hasBlankSeparators = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(marker);
    const fileMatch = trimmed.match(fileMarker);
    if (match || fileMatch) {
      hasMarkers = true;
      if (current.lines.length) groups.push(current);
      current = { name: (match || fileMatch)?.[1], lines: [] };
    } else if (!trimmed && current.lines.some((item) => item.trim())) {
      hasBlankSeparators = true;
      groups.push(current);
      current = { lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) groups.push(current);
  const batches = groups.map((group, index) => ({
    index: index + 1,
    cookies: parseCrunchyrollBlock(group.lines),
    rawLine: group.name || group.lines.find((line) => line.trim() && !line.trim().startsWith("#"))?.slice(0, 120) || "Crunchyroll",
    ...(group.name ? { sourceFile: group.name } : {}),
  })).filter((batch) => batch.cookies.length > 0);
  if (batches.length || hasMarkers || hasBlankSeparators) return batches;
  return parseCookiesFromText(value);
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { cookies?: string; start?: number; limit?: number };
  if (!body.cookies || typeof body.cookies !== "string") return new Response(JSON.stringify({ type: "error", message: "Aucun cookie fourni" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const batches = parseCrunchyrollBatches(body.cookies);
  if (!batches.length) return new Response(JSON.stringify({ type: "error", message: "Aucun cookie valide trouvé dans le texte" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const start = Math.max(0, Math.min(typeof body.start === "number" ? body.start : 0, batches.length));
  const limit = Math.max(1, Math.min(typeof body.limit === "number" ? body.limit : 50, 100));
  const end = Math.min(batches.length, start + limit);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(JSON.stringify({ type: "init", total: batches.length }) + "\n"));
      let valid = 0;
      let invalid = 0;
      for (let index = start; index < end; index += 1) {
        if (request.signal.aborted) break;
        const data = await validateCrunchyrollBatch(batches[index]);
        if (data.isValid) valid += 1; else invalid += 1;
        controller.enqueue(encoder.encode(JSON.stringify({ type: "result", data, progress: Math.round(((index + 1) / batches.length) * 100) }) + "\n"));
      }
      controller.enqueue(encoder.encode(JSON.stringify({ type: "done", total: batches.length, valid, invalid, nextStart: end, finished: end >= batches.length }) + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
