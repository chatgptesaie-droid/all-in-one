#!/usr/bin/env python3
"""
Paramount+ Selenium checker — appelé depuis Node.js via child_process.
Reçoit les cookies en JSON sur stdin, retourne le résultat en JSON sur stdout.

Usage:
    echo '<json_cookies>' | python paramount_selenium_checker.py
"""
from __future__ import annotations

import html as htmlmod
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service


# ── Helpers ─────────────────────────────────────────────────────────────────

def normalize_domain(domain: str) -> str:
    return domain.lower().lstrip('.')


def is_paramount_domain(domain: str) -> bool:
    d = normalize_domain(domain)
    return d in {'paramountplus.com', 'www.paramountplus.com'} or d.endswith('.paramountplus.com')


def detect_login_page(url: str, html: str) -> bool:
    lu = url.lower()
    lh = html.lower()
    if 'signin' in lu or 'login' in lu:
        return True
    if 'sign in' in lh or 'log in' in lh or 'login' in lh:
        return True
    return False


def extract_profile_names(html: str) -> List[str]:
    names: List[str] = []
    m = re.search(r'"accountProfiles"\s*:\s*(\[.*?\])\s*(?:,\s*"[A-Za-z0-9_]+"|\s*\})', html, flags=re.S)
    search_in = m.group(1) if m else html
    for match in re.finditer(r'"name"\s*:\s*"((?:\\.|[^"\\])*)"', search_in):
        name = match.group(1)
        try:
            name = name.encode('utf-8').decode('unicode_escape')
        except Exception:
            pass
        if name and name not in names and len(name) < 80:
            names.append(name)
    return names


def extract_account_details(html: str) -> Dict[str, Optional[str]]:
    details: Dict[str, Optional[str]] = {
        'Paramount+ Plan': None,
        'Price': None,
        'Next Billing Date': None,
        'Payment Method': None,
    }

    def clean_text(value: str) -> str:
        value = htmlmod.unescape(value)
        value = value.replace('&nbsp;', ' ')
        value = re.sub(r'<.*?>', ' ', value, flags=re.S)
        value = re.sub(r'\s+', ' ', value)
        return value.strip()

    has_labels = any(label.lower() in html.lower() for label in details)
    if not has_labels:
        return details

    skip_words = ['edit plan', 'edit payment', 'switch to annual', 'redeem', 'save', 'gift card', 'coupon']
    for label_text in details:
        pattern = re.compile(
            rf'(?is){re.escape(label_text)}\s*</(?:label|div|span)>\s*(?:<[^>]+>\s*)*(?:<div|<span|<p|<strong|<b)[^>]*>\s*(.*?)\s*(?:</(?:div|span|p|strong|b)>|<button|$)'
        )
        match = pattern.search(html)
        if match:
            value = clean_text(match.group(1))
            if value and not any(k in value.lower() for k in skip_words):
                details[label_text] = value

    return details


def build_session(cookies: List[Dict[str, Any]]) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    })
    for c in cookies:
        name = c.get('name', '')
        value = c.get('value', '')
        domain = normalize_domain(c.get('domain', ''))
        path = c.get('path', '/')
        if name and value and domain:
            try:
                session.cookies.set(name, value, domain=domain, path=path)
            except Exception:
                pass
    return session


def get_account_via_selenium(cookies: List[Dict[str, Any]], dump_dir: str) -> Optional[Dict[str, Optional[str]]]:
    """Charge /account/ via Selenium visible, exactement comme le script Python original."""
    try:
        options = webdriver.ChromeOptions()
        # headless=False pour voir la navigation
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36')

        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)

        try:
            # 1. Charger la page d'accueil pour pouvoir injecter les cookies
            driver.get('https://www.paramountplus.com/')
            time.sleep(3)

            # 2. Injecter les cookies en gérant correctement les domaines
            for c in cookies:
                name = c.get('name', '')
                value = c.get('value', '')
                raw_domain = c.get('domain', '')
                if not name or not value:
                    continue
                # Selenium accepte les domaines avec ou sans point en tête
                # mais le driver doit être sur le bon domaine
                domain_clean = raw_domain.lstrip('.')
                try:
                    cookie_dict: Dict[str, Any] = {
                        'name': name,
                        'value': value,
                        'path': c.get('path', '/'),
                    }
                    # N'ajouter le domain que si compatible avec l'URL actuelle
                    if 'paramountplus.com' in domain_clean:
                        cookie_dict['domain'] = domain_clean
                    driver.add_cookie(cookie_dict)
                except Exception:
                    pass

            time.sleep(1)

            # 3. Naviguer directement vers /account/ (comme le script original)
            account_url = 'https://www.paramountplus.com/account/'
            driver.get(account_url)
            WebDriverWait(driver, 15).until(EC.presence_of_all_elements_located((By.TAG_NAME, 'body')))
            time.sleep(3)

            account_html = driver.page_source

            # 5. Sauvegarder
            Path(dump_dir).mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            dump_path = Path(dump_dir) / f'account_selenium_{ts}.html'
            dump_path.write_text(account_html, encoding='utf-8', errors='ignore')

            # 6. Extraire les données — essai avec les labels HTML d'abord
            details = extract_account_details(account_html)
            has_data = any(v is not None and str(v).strip() for v in details.values())

            # 7. Si pas de données HTML, chercher dans CBS.Registry (JS rendu)
            if not has_data:
                details = extract_from_cbs_registry(account_html)
                has_data = any(v is not None and str(v).strip() for v in details.values())

            return details if has_data else None

        finally:
            driver.quit()

    except Exception as e:
        sys.stderr.write(f'[Selenium] Erreur: {e}\n')
        return None


def extract_from_cbs_registry(html: str) -> Dict[str, Optional[str]]:
    """Extrait les infos depuis CBS.Registry.user.* injecté dans le JS rendu."""
    details: Dict[str, Optional[str]] = {
        'Paramount+ Plan': None,
        'Price': None,
        'Next Billing Date': None,
        'Payment Method': None,
    }

    # Plan depuis sub_status ou packageCode
    sub = re.search(r'CBS\.Registry\.user\.sub_status\s*=\s*"([^"]+)"', html)
    if sub and sub.group(1) == 'SUBSCRIBER':
        details['Paramount+ Plan'] = 'Paramount+'
    elif sub:
        details['Paramount+ Plan'] = sub.group(1)

    pkg = re.search(r'CBS\.Registry\.user\.packageCode\s*=\s*"([^"]+)"', html)
    if pkg and not details['Paramount+ Plan']:
        details['Paramount+ Plan'] = pkg.group(1)

    plan = re.search(r'CBS\.Registry\.user\.plan\s*=\s*"([^"]+)"', html)
    if plan and not details['Paramount+ Plan']:
        details['Paramount+ Plan'] = plan.group(1)

    # Pays → pas directement un champ account mais utile
    country = re.search(r'CBS\.Registry\.userSubscriptionCountry\s*=\s*"([^"]+)"', html)
    if country and country.group(1) != 'false':
        details['Price'] = f'Country: {country.group(1)}'  # placeholder

    return details


def check(cookies_raw: List[Dict[str, Any]], dump_dir: str) -> Dict[str, Any]:
    relevant = [c for c in cookies_raw if is_paramount_domain(c.get('domain', ''))]

    result: Dict[str, Any] = {
        'is_valid': False,
        'status': 'invalid',
        'message': '',
        'profile_count': 0,
        'profile_names': [],
        'account_details': {
            'Paramount+ Plan': None,
            'Price': None,
            'Next Billing Date': None,
            'Payment Method': None,
        },
        'final_url': '',
    }

    if not relevant:
        result['message'] = 'Aucun cookie Paramount+ trouvé'
        return result

    session = build_session(cookies_raw)

    urls_to_test = [
        'https://www.paramountplus.com/',
        'https://www.paramountplus.com/account',
        'https://www.paramountplus.com/shows',
    ]

    for url in urls_to_test:
        try:
            r = session.get(url, timeout=15, allow_redirects=True)
            html = r.text[:4000]
            final_url = r.url
            is_login = detect_login_page(final_url, html)
            result['final_url'] = final_url

            if final_url.lower().endswith('/home') or '/home/' in final_url.lower():
                # Récupérer les profils
                try:
                    profile_r = session.get(
                        'https://www.paramountplus.com/user-profile/whos-watching/',
                        timeout=15,
                        allow_redirects=True,
                        headers={'Referer': 'https://www.paramountplus.com/'}
                    )
                    profile_names = extract_profile_names(profile_r.text)
                    result['profile_names'] = profile_names
                    result['profile_count'] = len(profile_names)
                except Exception:
                    pass

                # Récupérer les infos account via Selenium
                selenium_result = get_account_via_selenium(relevant, dump_dir)
                if selenium_result:
                    result['account_details'] = selenium_result

                if result['profile_count'] > 0:
                    names_str = ', '.join(result['profile_names'][:3])
                    result['is_valid'] = True
                    result['status'] = 'valid'
                    result['message'] = f"Cookie valide - {result['profile_count']} profil(s): {names_str}"
                    return result

            if r.status_code in (200, 302, 301) and not is_login:
                if not result['account_details']['Paramount+ Plan']:
                    selenium_result = get_account_via_selenium(relevant, dump_dir)
                    if selenium_result:
                        result['account_details'] = selenium_result
                result['is_valid'] = True
                result['status'] = 'valid'
                result['message'] = 'Cookie Paramount+ valide'
                return result

        except requests.RequestException:
            continue

    result['message'] = "Cookie invalide - aucune session valide détectée"
    return result


if __name__ == '__main__':
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({'is_valid': False, 'message': f'JSON invalide: {e}', 'error': True}))
        sys.exit(0)

    cookies = payload.get('cookies', [])
    dump_dir = payload.get('dump_dir', 'paramount_html_dumps')

    result = check(cookies, dump_dir)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
