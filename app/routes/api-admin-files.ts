import { isAdminRequest } from "~/lib/admin.server";
import { storageBucket, supabase, supabaseAdmin } from "~/lib/supabase";

const jsonHeaders = { "Content-Type": "application/json" };
const client = () => (supabaseAdmin || supabase).storage.from(storageBucket);

function invalidPath(path: string): boolean {
  return path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..");
}

type StorageEntry = { name: string; id: string | null; metadata: Record<string, unknown> | null };

async function listAll(path: string): Promise<StorageEntry[]> {
  const { data, error } = await client().list(path, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(error.message);
  return (data || []) as { name: string; id: string | null; metadata: Record<string, unknown> | null }[];
}

async function collectFiles(path: string): Promise<string[]> {
  let entries: StorageEntry[];
  try {
    entries = await listAll(path);
  } catch {
    return [path];
  }
  if (entries.length === 0) return [path];
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.id === null && entry.metadata === null) files.push(...await collectFiles(entryPath));
    else files.push(entryPath);
  }
  return files;
}

export async function loader({ request }: { request: Request }) {
  if (!isAdminRequest(request)) return new Response(JSON.stringify({ error: "Authentification admin requise" }), { status: 401, headers: jsonHeaders });
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  if (invalidPath(path)) return new Response(JSON.stringify({ error: "Chemin invalide" }), { status: 400, headers: jsonHeaders });
  try {
    return new Response(JSON.stringify({ path, data: await listAll(path) }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Lecture impossible" }), { status: 500, headers: jsonHeaders });
  }
}

export async function action({ request }: { request: Request }) {
  if (!isAdminRequest(request)) return new Response(JSON.stringify({ error: "Authentification admin requise" }), { status: 401, headers: jsonHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  const body = (await request.json().catch(() => ({}))) as { operation?: string; path?: string; newPath?: string; paths?: unknown };
  const path = body.path || "";
  const bulkPaths = body.operation === "bulk-delete" && Array.isArray(body.paths)
    ? body.paths.filter((item): item is string => typeof item === "string")
    : [];
  if (body.operation === "bulk-delete") {
    if (!bulkPaths.length || bulkPaths.some((item) => !item || invalidPath(item))) {
      return new Response(JSON.stringify({ error: "Chemins invalides" }), { status: 400, headers: jsonHeaders });
    }
  } else if (!path || invalidPath(path)) {
    return new Response(JSON.stringify({ error: "Chemin invalide" }), { status: 400, headers: jsonHeaders });
  }

  try {
    if (body.operation === "create-folder") {
      const { error } = await client().upload(`${path.replace(/\/+$/, "")}/.keep`, Buffer.from(""), { contentType: "text/plain", upsert: false });
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    if (body.operation === "rename") {
      const newPath = (body.newPath || "").trim();
      if (!newPath || invalidPath(newPath)) return new Response(JSON.stringify({ error: "Nouveau chemin invalide" }), { status: 400, headers: jsonHeaders });
      const files = await collectFiles(path);
      const { error } = await client().move(path, newPath);
      if (error && files.length > 0) {
        for (const file of files) {
          const target = `${newPath}${file.slice(path.length)}`;
          const moved = await client().move(file, target);
          if (moved.error) throw new Error(moved.error.message);
        }
      } else if (error) {
        const kept = await client().move(`${path.replace(/\/+$/, "")}/.keep`, `${newPath.replace(/\/+$/, "")}/.keep`);
        if (kept.error) throw new Error(error.message);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    if (body.operation === "delete" || body.operation === "bulk-delete") {
      const paths = body.operation === "bulk-delete" ? bulkPaths : [path];
      const targets = (await Promise.all(paths.map((item) => collectFiles(item)))).flat();
      const { error } = await client().remove([...new Set(targets)]);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: "Operation inconnue" }), { status: 400, headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Operation impossible" }), { status: 500, headers: jsonHeaders });
  }
}
