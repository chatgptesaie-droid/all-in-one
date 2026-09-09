import re
import datetime
import requests

url = "https://netflix.com/?nftoken=BgiQvuvcAxLDAdwiJoSlikBPMUEWHS%2FN2gjLg4OeNWwdei38A8YpsA77euu2VgGh0lbK9nZn%2BatPSIoM7TEbcICVyFo6OpyuqZWvnO9Q6i%2FYOGKKuQMlbA%2BxAXGVeaT5XX%2FhAXMW%2Fqvhox7Zy8xV%2F0mRX9QYUksT9PHCCdDW6TL5R5kUU6NBngU35HRcor9lKvaVs0NkJAWYdpYuXN1dDAn2a7MhXTfNNxJbxOLxnfm9Jtu6tonKxWy7HimSTO%2BUy5conOiZi4UeikLPvRgGIg4KDOroezj8WkPOul3OYw%3D%3D"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0.0.0 Safari/537.36"
}

# ── 1. Session + redirection nftoken → /browse ───────────────────────────────
session = requests.Session()
session.headers.update(headers)

r_browse = session.get(url, allow_redirects=True, timeout=15)
final_url = r_browse.url
print(f"[browse]  {final_url}  →  {r_browse.status_code}")
 
# ── Validation : token valide seulement si URL finale = /browse ──────────────
if not final_url.rstrip("/").endswith("/browse"):
    print("\n  [✗] TOKEN INVALIDE / EXPIRÉ")
    print(f"      URL finale : {final_url}")
    print("      Attendu    : https://www.netflix.com/browse")
    exit(1)
 
print("  [✓] Token valide\n")
browse_html = r_browse.text
with open("netflix_browse.html", "w", encoding="utf-8") as f:
    f.write(browse_html)

# ── 2. Navigation vers /account (cookies conservés par la session) ─────────
r_account = session.get("https://www.netflix.com/account", allow_redirects=True, timeout=15)
print(f"[account] {r_account.url}  →  {r_account.status_code}")

if "login" in r_account.url or r_account.url.rstrip("/").endswith(final_url.rstrip("/")):
    print("  [✗] Accès /account refusé (redirection vers login)")
    exit(1)

acct = r_account.text
with open("netflix_account.html", "w", encoding="utf-8") as f:
    f.write(acct)

# ── helpers ──────────────────────────────────────────────────────────────────
def jval(html, key):
    """Extrait la première valeur "key":"VALUE" ou "key":NUMBER du JSON embarqué."""
    m = re.search(
        r'"' + re.escape(key) + r'"\s*:\s*\{"fieldType":"[^"]+","value"\s*:\s*"?([^"}\n]+)"?',
        html
    )
    return m.group(1).replace("\\u00A0", " ").replace("\\x20", " ").replace("\\x2C", ",") if m else None

def jraw(html, key):
    """Extrait une valeur brute "key":"VALUE" (simple, sans fieldType wrapper)."""
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"([^"]+)"', html)
    return m.group(1) if m else None

def jnum(html, key):
    """Extrait une valeur numérique brute "key":NUMBER."""
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*(\d+)', html)
    return m.group(1) if m else None

# ── 3. Extraction profils (depuis /browse) ───────────────────────────────────
profile_names = list(dict.fromkeys(re.findall(r'"profileName"\s*:\s*"([^"]+)"', browse_html)))
owner_m = re.search(
    r'"profileName"\s*:\s*"([^"]+)"[^}]{0,200}"isAccountOwner"\s*:\s*true',
    browse_html
)
owner = owner_m.group(1) if owner_m else (profile_names[0] if profile_names else "N/A")

# ── 4. Extraction infos compte (depuis /account) ─────────────────────────────

# Plan name
plan_name = jval(acct, "localizedPlanName") or "N/A"

# Prix
plan_price_raw = jval(acct, "planPrice") or ""
plan_price = plan_price_raw.strip() if plan_price_raw else "N/A"

# Qualité vidéo
video_quality = jval(acct, "videoQuality") or "N/A"

# Pays (consumerCountry ou currentCountry)
country_m = re.search(r'"(?:consumerCountry|currentCountry)"\s*:\s*"([A-Z]{2})"', acct)
country = country_m.group(1) if country_m else "N/A"

# Membre depuis (timestamp ms → date ISO)
since_ts = jnum(acct, "memberSince")
if since_ts:
    member_since = datetime.datetime.utcfromtimestamp(int(since_ts) / 1000).strftime("%Y-%m-%d")
else:
    # fallback texte "October 2023"
    since_txt = jraw(acct, "memberSince")
    member_since = since_txt.replace("\\x20", " ") if since_txt else "N/A"

# Prochaine facturation
next_billing_raw = jval(acct, "nextBillingDate") or ""
next_billing = next_billing_raw.replace("\\x2019", " 19,").strip() if next_billing_raw else "N/A"
# second fallback : "Next payment: DATE" dans le HTML
if next_billing == "N/A":
    nb_m = re.search(r'Next payment:\s*([^<"]+)', acct)
    next_billing = nb_m.group(1).strip() if nb_m else "N/A"

# Type de paiement
# Source 1 : data-uia="...+payment+details+TYPE"
payment_type_m = re.search(
    r'data-uia="[^"]*\+payment\+details\+([A-Z0-9_]+)"', acct
)
if not payment_type_m:
    # Source 2 : JSON fieldType wrapper
    payment_type_m = re.search(
        r'"paymentMethodType"\s*:\s*\{"fieldType":"String","value"\s*:\s*"([^"]+)"', acct
    )
    payment_type = payment_type_m.group(1) if payment_type_m else "N/A"
else:
    payment_type = payment_type_m.group(1)

# Derniers chiffres carte / identifiant paiement
card_digits_m = re.search(
    r'"displayText"\s*:\s*\{"fieldType":"String","value"\s*:\s*"([^"]+)"', acct
)
card_digits = card_digits_m.group(1) if card_digits_m else "N/A"

# Statut membership
status_m = re.search(r'"membershipStatus"\s*:\s*"([^"]+)"', acct)
raw_status = status_m.group(1) if status_m else "N/A"
status_map = {
    "CURRENT_MEMBER": "Active",
    "CANCELED":       "Annulé",
    "GRACE_PERIOD":   "Grace Period",
}
status = status_map.get(raw_status, raw_status)

# Streams max
max_streams = jnum(acct, "maxStreams") or "N/A"

# Slot supplémentaire (extraMember / hasBOBO)
extra_m = re.search(r'"hasBOBOResult"\s*:\s*(true|false)', acct)
extra_slot = "Oui" if extra_m and extra_m.group(1) == "true" else "Non"

# ── 5. Affichage ─────────────────────────────────────────────────────────────
sep = "─" * 42
print(f"\n{sep}")
print("  Informations du compte")
print(sep)
print(f"  {'Profil':<24} {owner}")
print(f"  {'Plan':<24} {plan_name}")
print(f"  {'Prix':<24} {plan_price}")
print(f"  {'Qualite':<24} {video_quality}")
print(f"  {'Pays':<24} {country}")
print(f"  {'Membre depuis':<24} {member_since}")
print(f"  {'Prochaine facturation':<24} {next_billing}")
print(f"  {'Paiement':<24} {payment_type}")
print(f"  {'Carte':<24} **** {card_digits}")
print(f"  {'Statut':<24} {status}")
print(f"  {'Streams max':<24} {max_streams}")
print(f"  {'Slot supplementaire':<24} {extra_slot}")
print(sep)

if len(profile_names) > 1:
    print(f"\n  Autres profils : {', '.join(p for p in profile_names if p != owner)}")
