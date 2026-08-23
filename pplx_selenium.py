#!/usr/bin/env python3
"""
Injecte les cookies Perplexity dans Chrome via undetected-chromedriver,
puis :
  1. Page /account/details  → extrait email + display name
  2. Page d'accueil          → extrait le forfait (Forfait gratuit / Pro / …)
Affiche un résumé propre. Aucun fichier HTML n'est créé.
"""

import re
import time
from pathlib import Path

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

COOKIE_FILE = Path(r"e:\BUREAU\py\perplex.txt")
URL_ACCOUNT = "https://www.perplexity.ai/account/details"
URL_HOME    = "https://www.perplexity.ai/"


# ---------------------------------------------------------------------------
# Parse Netscape cookie file
# ---------------------------------------------------------------------------
def parse_netscape(path: Path) -> list[dict]:
    cookies = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        http_only = line.startswith("#HttpOnly_")
        if http_only:
            line = line[len("#HttpOnly_"):]
        fields = line.split("\t")
        if len(fields) < 7:
            continue
        domain, _, path_, secure, expiry, name, value = fields[:7]
        cookies.append({
            "name":     name,
            "value":    value,
            "domain":   domain if domain.startswith(".") else domain,
            "path":     path_ or "/",
            "secure":   secure.upper() == "TRUE",
            "httpOnly": http_only,
            **({"expiry": int(expiry)} if expiry.isdigit() else {}),
        })
    return cookies


# ---------------------------------------------------------------------------
# Helpers d'extraction HTML
# ---------------------------------------------------------------------------
def extract_email(html: str) -> str | None:
    emails = re.findall(r'[\w.+%-]{2,64}@[\w.-]{2,253}\.[a-z]{2,}', html)
    # Exclure les adresses perplexity.ai elles-mêmes
    user_emails = [e for e in emails if "perplexity.ai" not in e]
    return user_emails[0] if user_emails else None


def extract_display_name(html: str) -> str | None:
    m = re.search(
        r'(?:displayName|display_name|Nom complet|full_name|fullName|"name")\s*[":=]+\s*["\']([^"\'<>]{2,80})["\']',
        html, re.IGNORECASE,
    )
    return m.group(1) if m else None


def extract_plan(html: str) -> tuple[str, bool]:
    """
    Parse le span :
      <span class="flex items-center gap-0.5">
        Forfait gratuit
        <span aria-hidden="true" …>·</span>
        Mettre à niveau
      </span>

    Retourne (plan_label, has_upgrade) :
      - plan_label  : ex. "Forfait gratuit", "Pro", "Enterprise"
      - has_upgrade : True si "Mettre à niveau" est présent à côté
    """
    # Pattern principal : texte avant le séparateur ·
    m = re.search(
        r'<span\s[^>]*flex\s+items-center\s+gap-0\.5[^>]*>'
        r'\s*(.*?)'
        r'<span\s[^>]*aria-hidden[^>]*>',
        html, re.IGNORECASE | re.DOTALL,
    )
    if m:
        plan_text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        if plan_text:
            has_upgrade = bool(re.search(r'Mettre\s+à\s+niveau|Upgrade', html, re.IGNORECASE))
            return plan_text, has_upgrade

    # Fallback
    m2 = re.search(r'(Forfait\s+\w+|Pro\s+plan|Free\s+plan|Enterprise)', html, re.IGNORECASE)
    label = m2.group(1).strip() if m2 else "inconnu"
    has_upgrade = bool(re.search(r'Mettre\s+à\s+niveau|Upgrade', html, re.IGNORECASE))
    return label, has_upgrade


def wait_render(driver, timeout: int = 20):
    """Attendre que #root soit rempli."""
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: len(d.find_element(By.ID, "root").get_attribute("innerHTML")) > 1000
        )
        time.sleep(4)
    except Exception:
        print("[!] Timeout rendu — on dump ce qu'on a")
        time.sleep(3)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    cookies = parse_netscape(COOKIE_FILE)
    print(f"[*] {len(cookies)} cookies parsés")

    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    driver = uc.Chrome(options=opts, headless=False, version_main=151)

    try:
        # ------------------------------------------------------------------
        # 1. Charger le domaine + injecter cookies
        # ------------------------------------------------------------------
        print("[*] Chargement initial de perplexity.ai ...")
        driver.get(URL_HOME)
        time.sleep(3)

        injected = 0
        for c in cookies:
            try:
                driver.add_cookie(c)
                injected += 1
            except Exception as e:
                print(f"    [!] Cookie ignoré ({c['name']}): {e}")
        print(f"[*] {injected} cookies injectés")

        # ------------------------------------------------------------------
        # 2. Page account/details → email + display name + validation
        # ------------------------------------------------------------------
        print(f"\n[*] Navigation → {URL_ACCOUNT}")
        driver.get(URL_ACCOUNT)
        wait_render(driver)

        final_url    = driver.current_url
        html_account = driver.page_source

        email        = extract_email(html_account)
        display_name = extract_display_name(html_account)

        # Valide uniquement si un email a été détecté sur la page /account/details
        account_accessible = email is not None

        # ------------------------------------------------------------------
        # 3. Page d'accueil → forfait
        # ------------------------------------------------------------------
        print(f"\n[*] Navigation → {URL_HOME}")
        driver.get(URL_HOME)
        wait_render(driver)

        html_home = driver.page_source
        plan, has_upgrade = extract_plan(html_home)

        # ------------------------------------------------------------------
        # 4. Déterminer le statut final
        # ------------------------------------------------------------------
        # Règles :
        #   - /account/details inaccessible           → INVALIDE
        #   - accessible + "Mettre à niveau" présent  → VALIDE (FREE)
        #   - accessible + pas de "Mettre à niveau"   → VALIDE (PRO / ENTERPRISE)
        if not account_accessible:
            status     = "INVALIDE"
            status_ico = "❌"
        elif has_upgrade:
            status     = "VALIDE — FREE"
            status_ico = "✅"
        else:
            status     = f"VALIDE — {plan.upper()}"
            status_ico = "✅"

        # ------------------------------------------------------------------
        # 5. Résumé
        # ------------------------------------------------------------------
        print("\n" + "=" * 50)
        print(f"  {status_ico}  {status}")
        print("=" * 50)
        print(f"  Email        : {email or '—'}")
        print(f"  Nom affiché  : {display_name or '—'}")
        print(f"  Forfait      : {plan}")
        print(f"  Upgrade btn  : {'oui' if has_upgrade else 'non'}")
        print(f"  Account URL  : {final_url}")
        print("=" * 50)

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
