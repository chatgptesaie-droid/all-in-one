import { storageBucket, supabase, supabaseAdmin } from "~/lib/supabase";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as { path?: string; bucket?: string; limit?: number; offset?: number };
  const bucket = body.bucket || storageBucket;
  if (!bucket) {
    return new Response(JSON.stringify({ error: "SUPABASE_STORAGE_BUCKET is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const path = body.path || "";
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(body.limit, 1000)) : 1000;
  const offset = typeof body.offset === "number" ? Math.max(0, body.offset) : 0;
  const client = supabaseAdmin || supabase;

  const { data, error } = await client.storage
    .from(bucket)
    .list(path, { limit, offset, sortBy: { column: "name", order: "asc" } });

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
