# cr_api_checker.py  -  Crunchyroll checker via API (pas de navigateur)
#
# Usage :
#   python cr_api_checker.py crunchy.txt

import sys
import os
import re
import json
import base64
import requests

# ── Constantes API Crunchyroll ────────────────────────────────────────────────
TOKEN_URL      = "https://www.crunchyroll.com/auth/v1/token"
PROFILE_URL    = "https://www.crunchyroll.com/accounts/v1/me/profile"
ACCOUNT_URL    = "https://www.crunchyroll.com/accounts/v1/me"
# account_id injecte dynamiquement
SUBSCRIPTION_URL = "https://www.crunchyroll.com/subs/v4/accounts/{account_id}/subscriptions"

CLIENT_AUTH = "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6"

HEADERS_BASE = {
    "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
    "Accept":             "application/json, text/plain, */*",
    "Accept-Language":    "fr,fr-FR;q=0.9,en;q=0.8",
    "Origin":             "https://www.crunchyroll.com",
    "Referer":            "https://www.crunchyroll.com/fr/account/membership",
    "sec-ch-ua":          '"Chromium";v="152", "Not?A_Brand";v="24", "Microsoft Edge";v="152"',
    "sec-ch-ua-mobile":   "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest":     "empty",
    "sec-fetch-mode":     "cors",
    "sec-fetch-site":     "same-origin",
}

# ── Arguments ─────────────────────────────────────────────────────────────────
if len(sys.argv) < 2:
    print("Usage : python cr_api_checker.py <cookie_file>")
    sys.exit(1)

cookie_file = sys.argv[1]
if not os.path.isfile(cookie_file):
    print(f"[x] Fichier introuvable : {cookie_file}")
    sys.exit(1)

# ── Parsing cookies Netscape ──────────────────────────────────────────────────
def parse_netscape_cookies(filepath):
    jar = {}
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#HttpOnly_"):
                line = line[len("#HttpOnly_"):]
            elif not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            domain, flag, path, secure, expiry, name, value = parts[:7]
            jar[name] = value
    return jar

cookies   = parse_netscape_cookies(cookie_file)
print(f"[*] {len(cookies)} cookies charges depuis {cookie_file}")

cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
device_id  = cookies.get("device_id", "")
etp_rt     = cookies.get("etp_rt", "")

# ── Step 1 : POST /auth/v1/token ──────────────────────────────────────────────
print("[*] Etape 1 : obtention du token ...")

token_headers = {
    **HEADERS_BASE,
    "Authorization":    CLIENT_AUTH,
    "Content-Type":     "application/x-www-form-urlencoded",
    "Cookie":           cookie_str,
    "etp-anonymous-id": cookies.get("ajs_anonymous_id", ""),
}

token_body = {
    "grant_type":  "etp_rt_cookie",
    "scope":       "offline_access",
    "device_id":   device_id,
    "device_name": "Microsoft Edge on Windows",
    "device_type": "com.crunchyroll.windows.edge",
}

r_token = requests.post(TOKEN_URL, headers=token_headers, data=token_body, timeout=15)
print(f"  Status: {r_token.status_code}")

if r_token.status_code != 200:
    # Fallback refresh_token
    token_body["grant_type"]    = "refresh_token"
    token_body["refresh_token"] = etp_rt
    r_token = requests.post(TOKEN_URL, headers=token_headers, data=token_body, timeout=15)
    print(f"  Fallback status: {r_token.status_code}")
    if r_token.status_code != 200:
        print(f"\n  [X] COOKIE INVALIDE / EXPIRE")
        print(f"  Reponse: {r_token.text[:300]}")
        sys.exit(1)

token_data   = r_token.json()
access_token = token_data.get("access_token", "")
token_type   = token_data.get("token_type", "Bearer")

# ── Decode JWT pour account_id + infos ───────────────────────────────────────
jwt_payload = {}
try:
    payload_b64 = access_token.split(".")[1]
    payload_b64 += "=" * (4 - len(payload_b64) % 4)
    jwt_payload = json.loads(base64.b64decode(payload_b64))
except Exception:
    pass

account_id   = jwt_payload.get("etp_user_id") or jwt_payload.get("profile_id") or token_data.get("account_id", "N/A")
jwt_benefits = jwt_payload.get("benefits", [])
jwt_status   = jwt_payload.get("status", "N/A")
jwt_country  = jwt_payload.get("country", "N/A")

print(f"  [OK] Token obtenu | account_id: {account_id} | status JWT: {jwt_status}")

auth_headers = {
    **HEADERS_BASE,
    "Authorization": f"{token_type} {access_token}",
    "Cookie":        cookie_str,
}

# ── Step 2 : GET /accounts/v1/me  (email, created, etc.) ─────────────────────
print("[*] Etape 2 : recuperation du compte ...")

r_me = requests.get(ACCOUNT_URL, headers=auth_headers, timeout=15)
print(f"  Status: {r_me.status_code}")

me_data  = r_me.json() if r_me.status_code == 200 else {}
email    = me_data.get("email", "N/A")
created  = me_data.get("created", "N/A")[:10] if me_data.get("created") else "N/A"
ext_id   = me_data.get("external_id", "N/A")

# ── Step 2b : GET /accounts/v1/me/profile (username, profile_name) ───────────
r_profile = requests.get(PROFILE_URL, headers=auth_headers, timeout=15)
profile   = r_profile.json() if r_profile.status_code == 200 else {}
username  = profile.get("profile_name") or profile.get("username", "N/A")

# ── Step 3 : GET /subs/v4/accounts/{account_id}/subscriptions ────────────────
print("[*] Etape 3 : recuperation de l'abonnement ...")

sub_url = SUBSCRIPTION_URL.format(account_id=account_id)
r_sub   = requests.get(sub_url, headers=auth_headers, timeout=15)
print(f"  Status: {r_sub.status_code}")

sub_data     = {}
plan         = "N/A"
tier         = "N/A"
next_renewal = "N/A"
is_active    = "N/A"
is_premium   = "false"

if r_sub.status_code == 200:
    sub_data = r_sub.json()
    items    = sub_data.get("items", sub_data.get("subscriptions", []))

    if items:
        item         = items[0]
        sub_plan     = item.get("subscription_plan", {})
        plan         = sub_plan.get("name") or item.get("plan_name") or item.get("type", "N/A")
        tier         = sub_plan.get("tier") or item.get("tier", "N/A")
        next_renewal = item.get("next_renewal_date") or item.get("end_date", "N/A")
        is_active    = str(item.get("active", item.get("is_active", "N/A")))
        is_premium   = "false" if ("free" in str(plan).lower() or "gratuit" in str(plan).lower()) else "true"
    else:
        # Pas d'items = compte gratuit
        plan      = "Free Member"
        is_active = "true"
        is_premium = "false"
else:
    print(f"  Reponse: {r_sub.text[:300]}")
    # Fallback depuis le JWT
    if jwt_benefits:
        plan      = ", ".join(jwt_benefits)
        is_premium = "true"
    else:
        plan      = "Free Member"
        is_premium = "false"
    is_active = "true" if jwt_status not in ("", "N/A") else "N/A"

# ── Sauvegardes JSON ──────────────────────────────────────────────────────────
with open("cr_api_token.json",   "w", encoding="utf-8") as f: json.dump(token_data, f, indent=2)
with open("cr_api_profile.json", "w", encoding="utf-8") as f: json.dump(profile,    f, indent=2)
with open("cr_api_sub.json",     "w", encoding="utf-8") as f: json.dump(sub_data,   f, indent=2)

# ── Affichage ─────────────────────────────────────────────────────────────────
sep = "-" * 46
print(f"\n{sep}")
print("  [OK] COOKIE VALIDE")
print(sep)
print(f"  {'Username':<22} {username}")
print(f"  {'Email':<22} {email}")
print(f"  {'Account ID':<22} {account_id}")
print(f"  {'Pays':<22} {jwt_country}")
print(f"  {'Membre depuis':<22} {created}")
print(f"  {'Plan':<22} {plan}")
print(f"  {'Tier':<22} {tier}")
print(f"  {'Premium':<22} {is_premium}")
print(f"  {'Actif':<22} {is_active}")
print(f"  {'Prochaine facturation':<22} {next_renewal}")
print(sep)
print(f"  Dumps : cr_api_token.json | cr_api_profile.json | cr_api_sub.json")
