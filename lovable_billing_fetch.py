import requests
import json
import base64
import time
from datetime import datetime, timezone

COOKIE_FILE = "lovable.txt"
OUTPUT_FILE = "lovable_result.json"

# Step 1 — custom token via Lovable serverFn
URL_CUSTOM_TOKEN = "https://lovable.dev/_serverFn/68ab599f4622afff956b6dfdaf9920e6f68f5c450e35985200cf48a309ce633b"

# Step 2 — échange custom token → idToken Firebase
FIREBASE_API_KEY = "AIzaSyBQNjlw9Vp4tP4VVeANzyPJnqbG2wLbYPw"
URL_FIREBASE = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={FIREBASE_API_KEY}"

# Step 3 — credit-balance (workspace_id extrait du cookie lovable-workspace-id)
URL_CREDIT_BALANCE = "https://api.lovable.dev/workspaces/{workspace_id}/credit-balance"

HEADERS_LOVABLE = {
    "accept": "application/x-tss-framed, application/x-ndjson, application/json",
    "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "content-length": "0",
    "origin": "https://lovable.dev",
    "referer": "https://lovable.dev/settings/billing",
    "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
    "x-deployment-id": "645e2ac517c05a4b6dae331084cb9e8c3d010d1af95ed37819528e72618504c9",
    "x-tsr-serverfn": "true",
    "priority": "u=1, i",
}

HEADERS_FIREBASE = {
    "accept": "*/*",
    "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "content-type": "application/json",
    "origin": "https://lovable.dev",
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
    "priority": "u=1, i",
}


# ── helpers ───────────────────────────────────────────────────────────────────

def decode_jwt_payload(token: str) -> dict:
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return {}


def humanize_timestamps(d: dict) -> dict:
    for field in ("exp", "iat", "auth_time"):
        if field in d:
            d[f"{field}_human"] = datetime.fromtimestamp(
                d[field], tz=timezone.utc
            ).strftime("%Y-%m-%d %H:%M:%S UTC")
    return d


def load_cookies_from_netscape(filepath: str) -> dict:
    """Parse un fichier cookies Netscape (gère aussi les HttpOnly)."""
    cookies = {}
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#HttpOnly_"):
                line = line[len("#HttpOnly_"):]
            elif line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            cookies[parts[5]] = parts[6]
    return cookies


def get_workspace_id(cookies: dict) -> str | None:
    """
    Extrait le workspace_id depuis le cookie lovable-workspace-id.
    Format : "<user_id>:<workspace_id>"  ex: QMjyH240C9dU29sp7wzIDhoF7hy2:jpoIxxAAiRNa2KFrLV4h
    """
    raw = cookies.get("lovable-workspace-id", "")
    if ":" in raw:
        return raw.split(":", 1)[1]
    return raw or None


# ── step 1 ────────────────────────────────────────────────────────────────────

def get_custom_token(cookies: dict) -> dict:
    resp = requests.post(
        URL_CUSTOM_TOKEN,
        headers=HEADERS_LOVABLE,
        cookies=cookies,
        data="",
    )
    raw = resp.json()
    result = {"status": "unknown", "token": None, "token_decoded": None, "error": None}

    try:
        kv = dict(zip(raw["p"]["k"], raw["p"]["v"]))

        res_node = kv.get("result", {})
        if res_node.get("t") == 1:
            result["token"] = res_node["s"]
            result["status"] = "success"

        err_node = kv.get("error", {})
        if err_node.get("t") == 25:
            result["error"] = err_node.get("s", {}).get("message", {}).get("s", "unknown")
            result["status"] = "error"

    except (KeyError, TypeError):
        result["status"] = "parse_error"

    if result["token"]:
        result["token_decoded"] = humanize_timestamps(decode_jwt_payload(result["token"]))

    return result


# ── step 2 ────────────────────────────────────────────────────────────────────

def firebase_sign_in(custom_token: str) -> dict:
    resp = requests.post(
        URL_FIREBASE,
        headers=HEADERS_FIREBASE,
        json={"token": custom_token, "returnSecureToken": True},
    )
    data = resp.json()

    result = {
        "status": "success" if "idToken" in data else "error",
        "http_status": resp.status_code,
        "idToken": data.get("idToken"),
        "refreshToken": data.get("refreshToken"),
        "expiresIn": data.get("expiresIn"),
        "localId": data.get("localId"),
        "error": data.get("error"),
        "idToken_decoded": None,
    }

    if result["idToken"]:
        result["idToken_decoded"] = humanize_timestamps(decode_jwt_payload(result["idToken"]))

    return result


# ── step 3 ────────────────────────────────────────────────────────────────────

def get_credit_balance(id_token: str, workspace_id: str, cookies: dict) -> dict:
    url = URL_CREDIT_BALANCE.format(workspace_id=workspace_id)
    now_ms = int(time.time() * 1000)

    headers = {
        "accept": "*/*",
        "accept-language": "fr,fr-FR;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "authorization": f"Bearer {id_token}",
        "content-type": "application/json",
        "origin": "https://lovable.dev",
        "referer": "https://lovable.dev/",
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
        "x-lovable-read-after": str(now_ms),
        "priority": "u=1, i",
    }

    resp = requests.get(url, headers=headers, cookies=cookies)

    result = {
        "status": "success" if resp.status_code == 200 else "error",
        "http_status": resp.status_code,
        "workspace_id": workspace_id,
        "data": None,
        "error": None,
    }

    try:
        result["data"] = resp.json()
    except Exception:
        result["error"] = resp.text[:500]

    if resp.status_code != 200:
        result["error"] = result["data"]
        result["data"] = None

    return result


# ── main ──────────────────────────────────────────────────────────────────────

def check_account(cookie_file: str) -> dict:
    """
    Vérifie un compte Lovable à partir d'un fichier cookies.
    Retourne un dict avec le statut final et les infos disponibles.
    """
    result = {
        "file": cookie_file,
        "status": "INVALIDE",   # par défaut
        "email": None,
        "name": None,
        "workspace_id": None,
        "plan": None,
        "credits": None,
        "error": None,
    }

    try:
        cookies = load_cookies_from_netscape(cookie_file)
    except FileNotFoundError:
        result["error"] = f"Fichier introuvable : {cookie_file}"
        return result

    workspace_id = get_workspace_id(cookies)
    result["workspace_id"] = workspace_id

    # Plan depuis cookie lovable-workspace-plan ou lovable-flag-plan (JWT)
    plan_raw = cookies.get("lovable-workspace-plan")
    if not plan_raw:
        flag_plan = cookies.get("lovable-flag-plan", "")
        fp = decode_jwt_payload(flag_plan) if flag_plan else {}
        plan_raw = fp.get("plan")
    result["plan"] = plan_raw

    # Nom depuis le cookie lovable-session-id-v2 (JWT)
    session_jwt = cookies.get("lovable-session-id-v2", "")
    if session_jwt:
        sp = decode_jwt_payload(session_jwt)
        result["name"] = sp.get("name")

    # ── Step 1 : custom token
    step1 = get_custom_token(cookies)
    if step1["status"] != "success":
        result["error"] = f"[Step1] {step1['error']}"
        return result

    # ── Step 2 : Firebase idToken
    step2 = firebase_sign_in(step1["token"])
    if step2["status"] != "success":
        result["error"] = f"[Step2] {step2['error']}"
        return result

    dec2 = step2["idToken_decoded"] or {}
    result["email"] = dec2.get("email")

    # ── Step 3 : credit-balance
    if not workspace_id:
        result["error"] = "workspace_id manquant"
        return result

    step3 = get_credit_balance(step2["idToken"], workspace_id, cookies)
    if step3["status"] != "success":
        result["error"] = f"[Step3] HTTP {step3['http_status']} — {step3['error']}"
        return result

    # Tout réussi
    data = step3["data"] or {}
    result["status"] = "VALIDE"
    result["credits"] = data

    return result


def print_account_result(r: dict):
    tag = "✅ VALIDE  " if r["status"] == "VALIDE" else "❌ INVALIDE"
    print(f"\n{tag} | {r['file']}")
    print(f"  nom        : {r.get('name') or 'N/A'}")
    print(f"  email      : {r['email'] or 'N/A'}")
    print(f"  workspace  : {r['workspace_id'] or 'N/A'}")
    print(f"  plan       : {r['plan'] or 'N/A'}")
    if r["status"] == "VALIDE" and r["credits"]:
        for k, v in r["credits"].items():
            print(f"  {k:25s}: {v}")
    if r["error"]:
        print(f"  raison     : {r['error']}")


def main():
    import sys
    import glob

    # Accepte plusieurs fichiers en argument, sinon utilise COOKIE_FILE
    if len(sys.argv) > 1:
        files = []
        for pattern in sys.argv[1:]:
            files.extend(glob.glob(pattern))
        if not files:
            print("Aucun fichier trouvé.")
            return
    else:
        files = [COOKIE_FILE]

    print(f"Checking {len(files)} compte(s)...")
    print("─" * 60)

    results = []
    valides = 0

    for f in files:
        r = check_account(f)
        print_account_result(r)
        results.append(r)
        if r["status"] == "VALIDE":
            valides += 1

    print("\n" + "─" * 60)
    print(f"Résumé : {valides} VALIDE(S) / {len(files) - valides} INVALIDE(S) sur {len(files)} compte(s)")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"[*] Résultats sauvegardés dans {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
