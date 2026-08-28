import { storageBucket, supabase, supabaseAdmin } from "~/lib/supabase";
import { isAdminRequest } from "~/lib/admin.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!isAdminRequest(request)) {
    return new Response(JSON.stringify({ error: "Authentification admin requise" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as {
    bucket?: string;
    path?: string;
    fileBase64?: string;
    contentType?: string;
    upsert?: boolean;
  };

  const bucket = body.bucket || storageBucket;
  if (!bucket) {
    return new Response(JSON.stringify({ error: "SUPABASE_STORAGE_BUCKET is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const path = body.path;
  const fileBase64 = body.fileBase64;

  if (!path || typeof path !== "string") {
    return new Response(JSON.stringify({ error: "Path is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path.startsWith("/") || path.split("/").some((segment) => segment === ".." || segment === ".")) {
    return new Response(JSON.stringify({ error: "Chemin de fichier invalide" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!fileBase64 || typeof fileBase64 !== "string") {
    return new Response(JSON.stringify({ error: "fileBase64 is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (fileBase64.length > 15 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "Fichier trop volumineux (15 Mo maximum)" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileBuffer = Buffer.from(fileBase64, "base64");
  const client = supabaseAdmin || supabase;
  const { data, error } = await client.storage.from(bucket).upload(path, fileBuffer, {
    contentType: body.contentType ?? "application/octet-stream",
    upsert: body.upsert === true,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}
