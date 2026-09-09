function parseSetCookies(setCookieHeaders: string[] | string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookieHeaders) return cookies;

  const rawCookies = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];

  for (const raw of rawCookies) {
    const cookiePair = raw.split(";")[0];
    const [name, ...rest] = cookiePair.split("=");
    if (!name || rest.length === 0) continue;
    cookies[name.trim()] = rest.join("=").trim();
  }

  return cookies;
}

function getSetCookieValues(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=]+\s*=)/) : [];
}

type NetflixAccountInfo = Record<string, string | number | boolean | string[]>;

type DirectLoginResult = {
  index: number;
  url: string;
  isValid: boolean;
  finalUrl: string;
  status: number | null;
  message: string;
  profileNames?: string[];
  accountInfo?: NetflixAccountInfo;
};

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function decodeNetflixEscapes(value: string): string {
  return value
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseNetflixBrowseProfiles(html: string): string[] {
  const names = new Set<string>();

  const addNames = (value: string) => {
    const parts = value
      .split(/,\s*/)
      .map((name) => name.trim())
      .filter((name) => name && name.length <= 50 && !name.includes("<") && !name.includes("/"));
    for (const part of parts) {
      if (part) names.add(part);
    }
  };

  let match: RegExpMatchArray | null;
  const profileNameRegex = /"profileName"\s*:\s*"([^"]+)"/g;
  while ((match = profileNameRegex.exec(html)) !== null) {
    addNames(match[1]);
  }

  const profileListRegex = /outerHTML[^\"]*\"([^\"]+)\"/g;
  while ((match = profileListRegex.exec(html)) !== null) {
    addNames(match[1]);
  }

  const profileArrayRegex = /"profiles"\s*:\s*\[([^\]]+)\]/g;
  if ((match = profileArrayRegex.exec(html)) !== null) {
    addNames(match[1]);
  }

  return Array.from(names).slice(0, 20);
}

function parseNetflixAccountInfo(html: string): NetflixAccountInfo {
  const info: NetflixAccountInfo = {};

  const captureString = (regex: RegExp): string | undefined => {
    const match = html.match(regex);
    return match ? decodeNetflixEscapes(match[1]) : undefined;
  };

  const memberSinceTimestamp = html.match(
    /"memberSince"\s*:\s*\{\s*"fieldType"\s*:\s*"Numeric"\s*,\s*"value"\s*:\s*(\d+)/
  );
  if (memberSinceTimestamp) {
    const ts = Number(memberSinceTimestamp[1]);
    if (!Number.isNaN(ts)) {
      info.memberSince = new Date(ts).toISOString().split("T")[0];
    }
  } else {
    const memberSince = captureString(/"memberSince"\s*:\s*"([^"]+)"/);
    if (memberSince) info.memberSince = memberSince;
  }

  const planName = captureString(/"localizedPlanName"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  const videoQuality = captureString(/"videoQuality"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  const planPrice = captureString(/"planPrice"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  const nextBillingDate = captureString(/"nextBillingDate"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  const countryOfSignup = captureString(/"countryOfSignup"\s*:\s*"([^"]+)"/);
  const membershipStatus = captureString(/"membershipStatus"\s*:\s*"([^"]+)"/);
  const emailAddress = captureString(/"emailAddress"\s*:\s*"([^"]+)"/);

  const maxStreamsMatch = html.match(
    /"maxStreams"\s*:\s*\{\s*"fieldType"\s*:\s*"Numeric"\s*,\s*"value"\s*:\s*(\d+)/
  );
  const maxStreams = maxStreamsMatch ? Number(maxStreamsMatch[1]) : undefined;

  const paymentType = captureString(
    /"paymentMethods"\s*:\s*\{[^}]*"type"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/s
  );
  const paymentMethod = captureString(
    /"paymentMethod"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/s
  );
  const last4Digits = captureString(
    /"displayText"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/s
  );

  if (planName) info.planName = planName;
  if (videoQuality) info.videoQuality = videoQuality;
  if (planPrice) info.planPrice = planPrice;
  if (nextBillingDate) info.nextBillingDate = nextBillingDate;
  if (countryOfSignup) info.countryOfSignup = countryOfSignup;
  if (membershipStatus) info.membershipStatus = membershipStatus;
  if (emailAddress) info.emailAddress = emailAddress.replace(/\\x40/g, "@");
  if (typeof maxStreams === "number" && !Number.isNaN(maxStreams)) info.maxStreams = maxStreams;
  if (paymentType) info.paymentType = paymentType;
  if (paymentMethod) info.paymentMethod = paymentMethod;
  if (last4Digits) info.last4Digit = last4Digits;

  const profiles = parseNetflixBrowseProfiles(html);
  if (profiles.length > 0) {
    info.profiles = profiles;
  }

  return info;
}

async function followRedirects(
  startUrl: string,
  headers: Record<string, string>,
  maxRedirects = 10
): Promise<{ finalUrl: string; status: number; cookies: Record<string, string>; loginRedirect: boolean }> {
  let currentUrl = startUrl;
  const cookies: Record<string, string> = {};
  let status = 0;
  let loginRedirect = false;

  for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount++) {
    const response = await fetch(currentUrl, {
      headers: {
        ...headers,
        Cookie: buildCookieHeader(cookies),
      },
      redirect: "manual",
    });

    status = response.status;
    Object.assign(cookies, parseSetCookies(getSetCookieValues(response.headers)));

    const location = response.headers.get("location") || "";
    if (location && [301, 302, 303, 307, 308].includes(status)) {
      const nextUrl = new URL(location, currentUrl).toString();
      if (nextUrl.toLowerCase().includes("login")) {
        loginRedirect = true;
        return { finalUrl: nextUrl, status, cookies, loginRedirect };
      }
      currentUrl = nextUrl;
      continue;
    }

    return { finalUrl: currentUrl, status, cookies, loginRedirect };
  }

  return { finalUrl: currentUrl, status, cookies, loginRedirect };
}

async function fetchWithSession(
  startUrl: string,
  headers: Record<string, string>,
  cookies: Record<string, string>,
  maxRedirects = 10
): Promise<{ response: Response; finalUrl: string; body: string; cookies: Record<string, string> }> {
  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: { ...headers, Cookie: buildCookieHeader(cookies) },
      redirect: "manual",
    });
    Object.assign(cookies, parseSetCookies(getSetCookieValues(response.headers)));
    const location = response.headers.get("location");
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, finalUrl: currentUrl, body: await response.text(), cookies };
  }
  throw new Error("Trop de redirections");
}

function isNetflixBrowseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname.endsWith("netflix.com") && parsed.pathname.replace(/\/+$/, "") === "/browse";
  } catch {
    return false;
  }
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { urls } = await request.json();

  if (!urls || typeof urls !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun lien fourni" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const lines = urls
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) {
    return new Response(
      JSON.stringify({ type: "error", message: "Aucun lien trouve" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="135", "Not-A.Brand";v="8"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "init", total: lines.length }) + "\n")
      );

      let validCount = 0;
      let invalidCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        let urlString = raw;
        if (!/^https?:\/\//i.test(urlString) && /^www\./i.test(urlString)) {
          urlString = `https://${urlString}`;
        }

        let result: DirectLoginResult = {
          index: i + 1,
          url: raw,
          isValid: false,
          finalUrl: "",
          status: null,
          message: "",
        };

        if (!/^https?:\/\//i.test(urlString)) {
          result.message = "Lien invalide ou protocole manquant";
        } else {
          try {
            new URL(urlString);
          } catch {
            result.message = "URL invalide";
          }
        }

        if (!result.message) {
          try {
            const firstVisit = await fetchWithSession(urlString, headers, {});
            const browseNames = parseNetflixBrowseProfiles(firstVisit.body);
            const browseOk = firstVisit.response.status === 200 && isNetflixBrowseUrl(firstVisit.finalUrl) && browseNames.length > 0;
            const accountVisit = await fetchWithSession("https://www.netflix.com/account", headers, firstVisit.cookies);
            const accountInfo = parseNetflixAccountInfo(accountVisit.body);
            const accountLoginRedirect = accountVisit.finalUrl.toLowerCase().includes("/login");
            const accountOk = accountVisit.response.status === 200 && !accountLoginRedirect && !isNetflixBrowseUrl(accountVisit.finalUrl) && Object.keys(accountInfo).length > 0;
            const accountProfileNames = parseNetflixBrowseProfiles(accountVisit.body);
            const isValid = browseOk && accountOk;
            const finalUrl = accountOk ? accountVisit.finalUrl : firstVisit.finalUrl;
            const message = !browseOk
              ? `Invalide - redirection finale différente de /browse`
              : !accountOk
                ? `Invalide - /account non accessible`
                : `Valide - /browse puis /account accessibles`;

            result = {
              ...result,
              isValid,
              finalUrl,
              status: accountVisit.response.status,
              message,
              profileNames: browseNames.length > 0 ? browseNames : accountProfileNames,
              accountInfo,
            };
          } catch (error) {
            result = {
              ...result,
              isValid: false,
              message: `Erreur de connexion: ${error instanceof Error ? error.message : "Inconnue"}`,
            };
          }
        }

        if (result.isValid) {
          validCount += 1;
        } else {
          invalidCount += 1;
        }

        const progress = Math.round(((i + 1) / lines.length) * 100);
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "result", data: result, progress }) + "\n")
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "done", total: lines.length, valid: validCount, invalid: invalidCount }) + "\n")
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
