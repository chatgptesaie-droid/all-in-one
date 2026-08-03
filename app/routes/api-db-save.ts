import { supabaseAdmin } from "~/lib/supabase";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as {
    table?: string;
    record?: Record<string, any>;
  };

  const table = body.table || "files";
  const record = body.record;

  if (!record || typeof record !== "object") {
    return new Response(JSON.stringify({ error: "Record is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabaseAdmin.from(table).insert([record]);

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
