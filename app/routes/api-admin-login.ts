import { adminSessionCookie, clearAdminSessionCookie, isAdminConfigured, isAdminRequest, loginAdmin } from "~/lib/admin.server";

const jsonHeaders = { "Content-Type": "application/json" };

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  if (!isAdminConfigured()) {
    return new Response(JSON.stringify({ error: "ADMIN_PASSWORD n'est pas configure" }), { status: 503, headers: jsonHeaders });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string; logout?: boolean };
  if (body.logout === true) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...jsonHeaders, "Set-Cookie": clearAdminSessionCookie() },
    });
  }

  const token = loginAdmin(typeof body.password === "string" ? body.password : "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Mot de passe incorrect" }), { status: 401, headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...jsonHeaders, "Set-Cookie": adminSessionCookie(token) },
  });
}

export async function loader({ request }: { request: Request }) {
  return new Response(JSON.stringify({ authenticated: isAdminRequest(request), configured: isAdminConfigured() }), {
    headers: jsonHeaders,
  });
}
