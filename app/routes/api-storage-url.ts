import { storageBucket, supabase, supabaseAdmin } from "~/lib/supabase";


export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as {
    path?: string;
    bucket?: string;
    expiresIn?: number;
    public?: boolean;
  };

  const bucket = body.bucket || storageBucket;
  if (!bucket) {
    return new Response(JSON.stringify({ error: "SUPABASE_STORAGE_BUCKET is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const path = body.path;
  if (!path || typeof path !== "string") {
    return new Response(
      JSON.stringify({ error: "Path is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const client = supabaseAdmin || supabase;
  if (body.public) {
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return new Response(JSON.stringify({ url: data.publicUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const expiresIn = typeof body.expiresIn === "number" ? body.expiresIn : 60;
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ url: data?.signedUrl }), {
    headers: { "Content-Type": "application/json" },
  });
}
