#!/usr/bin/env python3
"""
Perplexity Selenium checker — appelé depuis Node.js via child_process.
Reçoit les cookies en JSON sur stdin, retourne le résultat en JSON sur stdout.

Usage:
    echo '<json_cookies>' | python pplx_selenium_checker.py

Logique identique à pplx_selenium.py :
  1. Charger perplexity.ai + injecter cookies
  2. /account/details → email + display name
  3. Page d'accueil → forfait (plan) + bouton upgrade
  4. Déterminer statut final
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from typing import Any, Dict, List, Optional

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

URL_ACCOUNT = "https://www.perplexity.ai/account/details"
URL_HOME    = "https://www.perplexity.ai/"


# ---------------------------------------------------------------------------
# Helpers d'extraction — repris exactement de pplx_selenium.py
# ---------------------------------------------------------------------------

def extract_email(html: str) -> Optional[str]:
    emails = re.findall(r'[\w.+%-]{2,64}@[\w.-]{2,253}\.[a-z]{2,}', html)
    user_emails = [e for e in emails if "perplexity.ai" not in e]
    return user_emails[0] if user_emails else None


def extract_display_name(html: str) -> Optional[str]:
    m = re.search(
        r'(?:displayName|display_name|Nom complet|full_name|fullName|"name")\s*[":=]+\s*["\']([^"\'<>]{2,80})["\']',
        html, re.IGNORECASE,
    )
    return m.group(1) if m else None


def extract_plan(html: str) -> tuple[str, bool]:
    """
    Retourne (plan_label, has_upgrade).
    Logique identique à pplx_selenium.py.
    """
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

    m2 = re.search(r'(Forfait\s+\w+|Pro\s+plan|Free\s+plan|Enterprise)', html, re.IGNORECASE)
    label = m2.group(1).strip() if m2 else "inconnu"
    has_upgrade = bool(re.search(r'Mettre\s+à\s+niveau|Upgrade', html, re.IGNORECASE))
    return label, has_upgrade


def wait_render(driver, timeout: int = 20):
    """Attendre que #root soit rempli — identique à pplx_selenium.py."""
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: len(d.find_element(By.ID, "root").get_attribute("innerHTML")) > 1000
        )
        time.sleep(4)
    except Exception:
        sys.stderr.write("[!] Timeout rendu — on dump ce qu'on a\n")
        time.sleep(3)


# ---------------------------------------------------------------------------
# Checker principal
# ---------------------------------------------------------------------------

def check(cookies_raw: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "is_valid": False,
        "status": "invalid",
        "email": None,
        "display_name": None,
        "plan": "inconnu",
        "has_upgrade": False,
        "account_accessible": False,
        "account_status": "INVALIDE",
        "message": "",
        "injected_count": 0,
    }

    if not cookies_raw:
        result["message"] = "Aucun cookie fourni"
        return result

    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1920,1080")
    # Perplexity détecte et bloque le mode headless (fingerprint différent).
    # On lance en mode visible mais hors écran pour ne pas déranger.
    opts.add_argument("--window-position=-32000,-32000")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")

    try:
        # Sur Windows, uc tente de copier chromedriver.exe et échoue si le
        # fichier de destination est déjà verrouillé (WinError 183).
        # Solution : pointer directement vers l'exécutable existant.
        UC_DIR      = os.path.join(os.path.expanduser("~"), "appdata", "roaming",
                                   "undetected_chromedriver", "undetected")
        target_exe  = os.path.join(UC_DIR, "undetected_chromedriver.exe")
        src_exe     = os.path.join(UC_DIR, "chromedriver-win32", "chromedriver.exe")

        # Copie manuelle si la cible n'existe pas encore
        if not os.path.exists(target_exe) and os.path.exists(src_exe):
            try:
                shutil.copy2(src_exe, target_exe)
            except OSError:
                pass  # déjà verrouillé — on laisse uc se débrouiller

        driver_path = target_exe if os.path.exists(target_exe) else None

        driver = uc.Chrome(
            options=opts,
            headless=False,  # headless = détecté et bloqué par Perplexity
            version_main=151,
            driver_executable_path=driver_path,
        )
    except Exception as e:
        result["message"] = f"Impossible de démarrer Chrome: {e}"
        return result

    try:
        # ------------------------------------------------------------------
        # 1. Charger le domaine + injecter cookies
        # ------------------------------------------------------------------
        driver.get(URL_HOME)
        time.sleep(3)

        injected = 0
        for c in cookies_raw:
            cookie_dict: Dict[str, Any] = {
                "name":   c.get("name", ""),
                "value":  c.get("value", ""),
                "path":   c.get("path", "/"),
                "secure": bool(c.get("secure", True)),
            }
            if not cookie_dict["name"] or not cookie_dict["value"]:
                continue
            # Domaine — Selenium préfère sans le point de tête
            domain = c.get("domain", ".perplexity.ai")
            cookie_dict["domain"] = domain if domain.startswith(".") else domain
            expiry = c.get("expiry", "")
            if expiry and str(expiry).isdigit() and int(expiry) > 0:
                cookie_dict["expiry"] = int(expiry)
            try:
                driver.add_cookie(cookie_dict)
                injected += 1
            except Exception:
                pass

        result["injected_count"] = injected

        # ------------------------------------------------------------------
        # 2. /account/details → email + display name
        # ------------------------------------------------------------------
        driver.get(URL_ACCOUNT)
        wait_render(driver)

        html_account = driver.page_source
        email        = extract_email(html_account)
        display_name = extract_display_name(html_account)
        account_accessible = email is not None

        # ------------------------------------------------------------------
        # 3. Page d'accueil → forfait
        # ------------------------------------------------------------------
        driver.get(URL_HOME)
        wait_render(driver)

        html_home = driver.page_source
        plan, has_upgrade = extract_plan(html_home)

        # ------------------------------------------------------------------
        # 4. Déterminer le statut final — règles identiques à pplx_selenium.py
        # ------------------------------------------------------------------
        if not account_accessible:
            status_label = "INVALIDE"
            is_valid     = False
        elif has_upgrade:
            status_label = "VALIDE — FREE"
            is_valid     = True
        else:
            status_label = f"VALIDE — {plan.upper()}"
            is_valid     = True

        result.update({
            "is_valid":           is_valid,
            "status":             "valid" if is_valid else "invalid",
            "email":              email,
            "display_name":       display_name,
            "plan":               plan,
            "has_upgrade":        has_upgrade,
            "account_accessible": account_accessible,
            "account_status":     status_label,
            "message":            status_label if is_valid else "Cookie Perplexity invalide",
        })

    finally:
        driver.quit()

    return result


# ---------------------------------------------------------------------------
# Entry point — lit JSON depuis stdin, écrit JSON sur stdout
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"is_valid": False, "message": f"JSON invalide: {e}", "error": True}))
        sys.exit(0)

    cookies = payload.get("cookies", [])
    result  = check(cookies)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
