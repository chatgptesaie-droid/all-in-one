import type { CookieBatch, CookieEntry, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

const PRIME_URL = "https://www.primevideo.com/";

export function parsePrimeCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const blocks = content.replace(/\r/g, "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);

  for (const block of blocks) {
    const cookies = parsePrimeCookieBlock(block);
    if (cookies.length > 0) {
      batches.push({
        index: batches.length + 1,
        cookies,
        rawLine: block.split("\n")[0].slice(0, 120),
      });
    }
  }

  return batches;
}

function parsePrimeCookieBlock(block: string): CookieEntry[] {
  const cookies: CookieEntry[] = [];
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;

    if (line.includes("\t")) {
      const parts = line.split("\t");
      if (parts.length >= 7) {
        for (let i = 0; i <= parts.length - 7; i += 7) {
          cookies.push({
            domain: parts[i],
            flag: parts[i + 1],
            path: parts[i + 2],
            secure: parts[i + 3].toUpperCase() === "TRUE",
            expiry: parts[i + 4],
            name: parts[i + 5],
            value: parts[i + 6],
          });
        }
      }
      continue;
    }

    const pairs = line.split(";").map((pair) => pair.trim()).filter(Boolean);
    for (const pair of pairs) {
      if (!pair.includes("=")) continue;
      const [name, ...rest] = pair.split("=");
      cookies.push({
        domain: ".primevideo.com",
        flag: "TRUE",
        path: "/",
        secure: true,
        expiry: "0",
        name: name.trim(),
        value: rest.join("=").trim(),
      });
    }
  }

  return cookies;
}

export async function validatePrimeBatch(batch: CookieBatch): Promise<ValidationResult> {
  if (!batch.cookies.length) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: "Aucun cookie fourni pour Prime Video",
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }

  const cookieHeader = batch.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookieHeader,
  };

  try {
    const resp = await fetch(PRIME_URL, {
      headers,
      redirect: "follow",
    });

    const finalUrl = resp.url;
    const html = await resp.text();
    const normalized = html.toLowerCase();

    if (resp.status >= 400) {
      return {
        batchIndex: batch.index,
        isValid: false,
        message: `Erreur Prime Video: ${resp.status}`,
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: { status_code: resp.status, final_url: finalUrl },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    const isAuthRedirect = /signin|auth|sign in/i.test(finalUrl) || /signin|auth|sign in/i.test(normalized);
    const hasSignedInSignals = /continue watching|watchlist|prime video|your watchlist|home/i.test(normalized);

    if (isAuthRedirect && !hasSignedInSignals) {
      return {
        batchIndex: batch.index,
        isValid: false,
        message: "Cookie invalide - redirection vers la connexion",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: { status_code: resp.status, final_url: finalUrl },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    const classification = classifyPrimeHtml(html, finalUrl, hasSignedInSignals);

    if (!classification.isValid) {
      return {
        batchIndex: batch.index,
        isValid: false,
        message: classification.message,
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: {
          plan: classification.plan,
          plan_label: classification.plan,
          status_code: resp.status,
          final_url: finalUrl,
          source: classification.source,
          profiles: classification.profiles,
          profile_names: classification.profiles,
          profile_count: classification.profileCount,
          active_profile_name: classification.activeProfileName,
        },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    return {
      batchIndex: batch.index,
      isValid: true,
      message: `Compte Prime Video detecte: ${classification.plan}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {
        plan: classification.plan,
        plan_label: classification.plan,
        status_code: resp.status,
        final_url: finalUrl,
        source: classification.source,
        profiles: classification.profiles,
        profile_names: classification.profiles,
        profile_count: classification.profileCount,
        active_profile_name: classification.activeProfileName,
      },
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  } catch (err) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Erreur de connexion: ${err instanceof Error ? err.message : "Inconnue"}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }
}

function classifyPrimeHtml(html: string, finalUrl: string, hasSignedInSignals: boolean): {
  plan: string;
  source: string;
  isValid: boolean;
  message: string;
  profiles: string[];
  profileCount: number;
  activeProfileName: string | null;
} {
  const normalized = html.replace(/\s+/g, " ").toLowerCase();
  const profiles = extractPrimeProfiles(html);
  const profileCount = profiles.names.length;

  if (/inscrivez[- ]vous[\s\u00a0]+à[\s\u00a0]+amazon[\s\u00a0]+prime|amazon[\s\u00a0]+prime[\s\u00a0]+inscrivez[- ]vous/i.test(normalized)) {
    return {
      plan: "Invalid",
      source: "invalid-prime-signup",
      isValid: false,
      message: "Compte invalide - page d'inscription Prime détectée",
      profiles: profiles.names,
      profileCount,
      activeProfileName: profiles.activeProfileName,
    };
  }

  if (profileCount === 0) {
    return {
      plan: "Invalid",
      source: "no-profiles",
      isValid: false,
      message: "Cookie invalide - aucun profil détecté",
      profiles: profiles.names,
      profileCount,
      activeProfileName: profiles.activeProfileName,
    };
  }

  return {
    plan: "Premium",
    source: "prime-home-detected",
    isValid: true,
    message: "Compte Prime Video valide - profils détectés",
    profiles: profiles.names,
    profileCount,
    activeProfileName: profiles.activeProfileName,
  };
}

function extractPrimeProfiles(html: string): { names: string[]; activeProfileName: string | null } {
  const names: string[] = [];
  const activeProfile = extractJsonValue(html, "activeProfile");
  const activeProfileName = typeof activeProfile?.name === "string" ? activeProfile.name.trim() : null;

  const otherProfiles = extractJsonValue(html, "otherProfiles");
  if (Array.isArray(otherProfiles)) {
    for (const profile of otherProfiles) {
      if (profile && typeof profile.name === "string" && profile.name.trim()) {
        names.push(profile.name.trim());
      }
    }
  }

  if (activeProfileName && activeProfileName.trim() && !names.some((name) => name.toLowerCase() === activeProfileName.toLowerCase())) {
    names.unshift(activeProfileName.trim());
  }

  const uniqueNames = names.filter((name, index, array) => {
    const normalized = name.trim().toLowerCase();
    return normalized && array.findIndex((entry) => entry.trim().toLowerCase() === normalized) === index;
  });

  return { names: uniqueNames, activeProfileName: activeProfileName?.trim() || null };
}

function extractJsonValue(html: string, key: string): any {
  const marker = `"${key}"`;
  const keyIndex = html.indexOf(marker);
  if (keyIndex === -1) return null;

  const startIndex = findOpeningCharAfter(html, keyIndex, key === "otherProfiles" ? "[" : "{");
  if (startIndex === -1) return null;

  const endIndex = findMatchingDelimiter(html, startIndex, key === "otherProfiles" ? "[" : "{", key === "otherProfiles" ? "]" : "}");
  if (endIndex === -1) return null;

  const raw = html.slice(startIndex, endIndex + 1);
  try {
    return JSON.parse(raw);
  } catch {
    const normalized = raw
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&")
      .replace(/\\u0027/g, "'");

    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }
}

function findOpeningCharAfter(text: string, startIndex: number, openChar: string): number {
  for (let i = startIndex; i < text.length; i += 1) {
    if (text[i] === openChar) {
      return i;
    }
  }
  return -1;
}

function findMatchingDelimiter(text: string, startIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}
