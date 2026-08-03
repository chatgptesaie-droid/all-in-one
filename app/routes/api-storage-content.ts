import { storageBucket, supabase, supabaseAdmin } from "~/lib/supabase";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as { path?: string; bucket?: string };
  const bucket = body.bucket || storageBucket;
  if (!bucket) {
    return new Response(JSON.stringify({ error: "SUPABASE_STORAGE_BUCKET is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const path = body.path;

  if (!path || typeof path !== "string") {
    return new Response(JSON.stringify({ error: "Path is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = supabaseAdmin || supabase;
  const { data, error } = await client.storage.from(bucket).download(path);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const arrayBuffer = await data.arrayBuffer();
  return new Response(arrayBuffer, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${path.split("/").pop() || "file"}"`,
    },
  });
}
