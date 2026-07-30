import type { CookieBatch, ValidationResult } from "~/lib/netflix.server";
import { formatBatchNetscape, parseCookiesFromText } from "~/lib/netflix.server";

export async function validateSpotifyBatch(batch: CookieBatch): Promise<ValidationResult> {
  const sp_dc = batch.cookies.find((c) => c.name === "sp_dc");
  const sp_key = batch.cookies.find((c) => c.name === "sp_key");

  if (!sp_dc || !sp_key) {
    return {
      batchIndex: batch.index,
      isValid: false,
      message: "Cookies Spotify incomplets (sp_dc/sp_key manquant)",
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
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookieHeader,
  };

  try {
    const resp = await fetch("https://open.spotify.com/", {
      headers,
      redirect: "follow",
    });

    const finalUrl = resp.url;

    if (resp.status === 200) {
      if (finalUrl.toLowerCase().includes("login") || finalUrl.toLowerCase().includes("accounts.spotify.com")) {
        return {
          batchIndex: batch.index,
          isValid: false,
          message: "Cookie invalide - Redirection vers login",
          netflixId: null,
          cookiesData: batch.cookies,
          accountInfo: { status_code: resp.status, final_url: finalUrl },
          netscapeFormat: formatBatchNetscape(batch.cookies),
        };
      }

      const html = await resp.text();
      const info = extractAccountInfo(html);

      // try /account for richer info
      try {
        const acct = await fetch("https://www.spotify.com/account/overview/", { headers, redirect: "follow" });
        if (acct.status === 200 && !acct.url.toLowerCase().includes("login")) {
          const acctHtml = await acct.text();
          Object.assign(info, extractAccountInfo(acctHtml));
        }
      } catch {}

      info.status_code = resp.status;
      info.final_url = finalUrl;

      return {
        batchIndex: batch.index,
        isValid: true,
        message: "Cookie Spotify valide",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: info,
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    if (resp.status === 302 || resp.status === 301) {
      const loc = resp.headers.get("location") || "";
      if (loc.toLowerCase().includes("login") || loc.toLowerCase().includes("accounts.spotify.com")) {
        return {
          batchIndex: batch.index,
          isValid: false,
          message: "Cookie expiré - Redirection vers login",
          netflixId: null,
          cookiesData: batch.cookies,
          accountInfo: { status_code: resp.status, location: loc },
          netscapeFormat: formatBatchNetscape(batch.cookies),
        };
      }
      return {
        batchIndex: batch.index,
        isValid: false,
        message: `Redirection vers ${loc}`,
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: { status_code: resp.status, location: loc },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    if (resp.status === 401) {
      return {
        batchIndex: batch.index,
        isValid: false,
        message: "Cookie invalide - Authentification requise",
        netflixId: null,
        cookiesData: batch.cookies,
        accountInfo: { status_code: resp.status },
        netscapeFormat: formatBatchNetscape(batch.cookies),
      };
    }

    return {
      batchIndex: batch.index,
      isValid: false,
      message: `Statut HTTP ${resp.status}`,
      netflixId: null,
      cookiesData: batch.cookies,
      accountInfo: {},
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

function extractAccountInfo(html: string): Record<string, any> {
  const info: Record<string, any> = {};

  // email: several possible shapes
  const emailMatch = html.match(/"email"\s*:\s*"([^\"]+)"/) || html.match(/data-email="([^"]+)"/i);
  if (emailMatch) info.email = emailMatch[1];

  // display name / profile name
  const nameMatch = html.match(/"displayName"\s*:\s*"([^\"]+)"/) || html.match(/data-testid="account-name"[^>]*>([^<]+)/i) || html.match(/profile[\-\_]name["']?\s*[:=]\s*"([^\"]+)"/i);
  if (nameMatch) info.display_name = nameMatch[1];

  // plan: try JSON keys first
  const planMatch = html.match(/"plan"\s*:\s*"([^\"]+)"/) || html.match(/"productState"\s*:\s*"([^\"]+)"/);
  if (planMatch) info.plan = planMatch[1];

  // Try other common keys or visible text for plan name
  if (!info.plan) {
    // First look for embedded JSON widgets that include planName
    const planNameJson = html.match(/"planName"\s*:\s*"([^\"]+)"/);
    if (planNameJson) {
      info.plan = planNameJson[1].replace(/\u00A0/g, ' ').trim();
      info.planName = info.plan;
    }

    // JSON-like localized plan name
    const localized = html.match(/localizedPlanName"\s*:\s*\{[^}]*"value"\s*:\s*"([^\"]+)"/);
    if (localized) {
      info.plan = decodeURIComponent(localized[1]);
      info.planName = info.plan;
    }
  }

  if (!info.plan) {
    // Visible text patterns: look for common plan names in the page
    // Search for plan keywords inside tag contents (prefer longer matches like 'Premium Duo')
    const visibleTag = html.match(/>([^<]{1,60}?(Premium(?:\s+Duo|\s+Family|\s+Individual)?|Premium Duo|Premium Family|Free|Gratuit|Duo|Family|Student)[^<]{0,60})</i);
    if (visibleTag) {
      let planText = visibleTag[1].trim();
      // extract the matched keyword from the capture
      const kw = planText.match(/(Premium(?:\s+Duo|\s+Family|\s+Individual)?|Premium Duo|Premium Family|Free|Gratuit|Duo|Family|Student)/i);
      if (kw) planText = kw[1];

      const mapping: Record<string, string> = {
        gratuit: 'Free',
        'premium duo': 'Premium Duo',
        'premium family': 'Premium Family',
        premium: 'Premium',
        duo: 'Duo',
        family: 'Family',
        student: 'Student',
      };
      const key = planText.toLowerCase();
      info.plan = mapping[key] || planText.replace(/\s+/g, ' ').trim();
      info.planName = info.plan;
    } else {
      // final fallback: any isolated keyword anywhere
      const visible = html.match(/\b(Premium(?:\s+Duo|\s+Family|\s+Individual)?|Premium Duo|Premium Family|Free|Gratuit|Duo|Family|Student)\b/i);
      if (visible) {
        const key = visible[1].toLowerCase();
        const mapping: Record<string, string> = { gratuit: 'Free', 'premium duo': 'Premium Duo', 'premium family': 'Premium Family', premium: 'Premium', duo: 'Duo', family: 'Family', student: 'Student' };
        info.plan = mapping[key] || visible[1];
        info.planName = info.plan;
      }
    }
  }

  // If display name still missing, try other visible selectors (like nav profile)
  if (!info.display_name) {
    const altName = html.match(/<button[^>]*aria-label="([^"]+)"[^>]*>\s*Profil/i) || html.match(/<span[^>]*class="[^"]*(profile|display)[^"]*"[^>]*>([^<]+)</i);
    if (altName) info.display_name = altName[1] || altName[2];
  }

  const countryMatch = html.match(/"country"\s*:\s*"([^\"]+)"/);
  if (countryMatch) info.country = countryMatch[1];

  const createdMatch = html.match(/"createdAt"\s*:\s*(\d+)/);
  if (createdMatch) {
    try {
      let ts = parseInt(createdMatch[1], 10);
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      info.member_since = new Date(ts * 1000).toISOString().split("T")[0];
    } catch {}
  }

  const nextBilling = html.match(/"nextBillingDate"\s*:\s*"([^\"]+)"/);
  if (nextBilling) info.next_billing_date = nextBilling[1];

  if (!info.plan && info.planName) {
    info.plan = info.planName;
  }

  return info;
}
