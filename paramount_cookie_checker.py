#!/usr/bin/env python3
"""Paramount+ Cookie Checker.

Parses a Netscape HTTP Cookie file and tests whether the cookies are valid for
Paramount+ by loading the site with the cookies attached and checking whether a
login redirect occurs.

Usage:
    python paramount_cookie_checker.py path/to/cookies.txt
    python paramount_cookie_checker.py --stdin
    python paramount_cookie_checker.py --sample
"""

from __future__ import annotations

import argparse
import html as htmlmod
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, NoSuchDriverException
    from webdriver_manager.chrome import ChromeDriverManager
    from selenium.webdriver.chrome.service import Service
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


SAMPLE_COOKIE_TEXT = '''# Netscape HTTP Cookie File
.paramountplus.com	TRUE	/	FALSE	1786854308	sfmc_sub	undefined
.paramountplus.com	TRUE	/	FALSE	1821322424	ab.storage.userId.8cb8412e-2475-416f-b1df-c03199764b1f	%7B%22g%22%3A%221845479%22%2C%22c%22%3A1786762424271%2C%22l%22%3A1786762424275%7D
www.paramountplus.com	FALSE	/account	FALSE	1786854308	pplus_timezone	Atlantic%2FReykjavik
.paramountplus.com	TRUE	/	FALSE	1786854308	mid	undefined
.paramountplus.com	TRUE	/	FALSE	1821322499	kv_install_sent	1786762403991
.paramountplus.com	TRUE	/	FALSE	1786854308	l	undefined
www.paramountplus.com	FALSE	/	FALSE	1794539884	abtest_api_overrides	%7B%7D
www.paramountplus.com	FALSE	/	FALSE	1809658428	cbsiaa	25266120
www.paramountplus.com	FALSE	/	FALSE	1818299972	CBS_RR	US
www.paramountplus.com	FALSE	/	FALSE	1821322427	ptv_device_id	3f0ebc51-805a-4209-aa1c-d184c674b88f
www.paramountplus.com	FALSE	/	FALSE	1818298422	CBS_COM	RkQ2QUIzQzlDOTJBQzIyOUQ2NDQ0QUEzQkEzODMwRTZDMzkxOERFRTFEODc4OUJCNDg4Q0FFNUIxRDgxMTFDOToxODE4Mjk4NDIxNzIwOjM0YTkwYWZlNzU5MDEzN2VjZmI1NGYzZjk0NWNkNTI1OjMuMDow
www.paramountplus.com	FALSE	/	FALSE	1786854308	muxData	=undefined&mux_viewer_id=c3280a30-f8cd-44c4-8fe0-0762616faa34&msn=0.043872085106650305&sid=37378f41-8277-425c-ad79-7337616faa37&sst=1758276332087&sex=1758277833378
www.paramountplus.com	FALSE	/	FALSE	1786845835	ovvuid	2714adf7-727f-4fed-a02f-49ee15cbe26e
www.paramountplus.com	FALSE	/	FALSE	1786850372	WcoSMza	04594e68edb6472e99ad410383b0b070.ce68c6de150ff3329f8ce5b498c2ae6e6c1d32a9c39c1d8084334192f3be8bed4653850e340fdb265988e55f6aee31e672f1580c4fc628fdfe9d712a194912a6c39d8e5eb6c8edb61a9d37c863ee0bf9144869c025e89849e097b3a3c709b0c1dfc4864620876dad9db15b92918df6e6278f71f4638557e5f36d755c0ff5f22f06f0c39bd5517c4b55f3bf30c48c1e6c2595a56a62607e84cadb89df2de1c0d50dea04aef0d08c5fc5bcbdfa1796b7a07c87b9267a227bad2a0a6ef1fd4fe8d335da319e0b5757628fb60f1378e53821f8d6143654029a541c31946278a1ac9935.0x4865fd97f8dbc294a6d0b226f8a266292c18fc97eda6f9ff41d077ea0d136b41
.paramountplus.com	TRUE	/	TRUE	1818299987	IR_PI	d458ed6d-984c-11f1-aced-4bbb00147e74%7C1786850387637
.paramountplus.com	TRUE	/	FALSE	1786769999	first_page_today	false
.paramountplus.com	TRUE	/	FALSE	1786854308	u	undefined
www.paramountplus.com	FALSE	/	FALSE	1786767577	tn_vw	627
.paramountplus.com	TRUE	/	FALSE	1786854308	OptanonAlertBoxClosed	2025-09-19T10:04:43.273Z
.paramountplus.com	TRUE	/	FALSE	1786854308	prevPageType	account
www.paramountplus.com	FALSE	/	FALSE	1818298427	pin_switch	0
.paramountplus.com	TRUE	/	TRUE	1794539986	_rdt_uuid	1786759439066.4c78b61e-7655-4711-be35-a320bba7f56e
.paramountplus.com	TRUE	/	FALSE	1821323987	kv_id	kwb06b8c89ca41d
.paramountplus.com	TRUE	/	FALSE	1821323981	ab.storage.sessionId.8cb8412e-2475-416f-b1df-c03199764b1f	%7B%22g%22%3A%22f5ae657b-f704-2f5a-4352-044115c20ece%22%2C%22e%22%3A1786765781482%2C%22c%22%3A1786762424273%2C%22l%22%3A1786763981482%7D
.paramountplus.com	TRUE	/	FALSE	1818299985	OptanonConsent	isGpcEnabled=0&datestamp=Sat+Aug+15+2026+03%3A19%3A45+GMT%2B0000+(heure+moyenne+de+Greenwich)&version=202601.2.0&browserGpcFlag=0&isIABGlobal=false&identifierType=null&hosts=&consentId=fcbf3557dd9e24e4a5e1cd3886886a95f2e92170d4fdd42c1a1f9bc5dceba29a&interactionCount=3&isAnonUser=0&landingPath=NotLandingPage&groups=1%3A1%2C2%3A1%2C3%3A1%2C4%3A1%2C5%3A1&iType=&intType=1&geolocation=ES%3BVC&AwaitingReconsent=false
.paramountplus.com	TRUE	/	FALSE	1786854308	j	undefined
.paramountplus.com	TRUE	/	TRUE	1786854308	__pxvid	e2928c43-953f-11f0-aa86-1efef643c8bc
.paramountplus.com	TRUE	/	FALSE	1786854308	_clck	1y1qce1%5E2%5Efzg%5E0%5E2088
.paramountplus.com	TRUE	/	FALSE	1794539987	_fbp	fb.1.1786759438440.353972170451551163
.paramountplus.com	TRUE	/	FALSE	1794535438	_gcl_au	1.1.1379771207.1786759438
.paramountplus.com	TRUE	/	FALSE	1818299988	_pin_unauth	dWlkPU1qZzRPV0UzTTJJdFlqWmtaaTAwWTJZNUxXRXpZelF0WW1GbFptTTRZMlZqTm1JeA
www.paramountplus.com	FALSE	/	FALSE	1786854308	_pxvid	e26fccf2-953f-11f0-a78b-f3c52c3c48a7
.paramountplus.com	TRUE	/	FALSE	1786854308	_scid	KF9zGE0sZ7sHD_uGMDe4eEFkP5m7x2fn
.paramountplus.com	TRUE	/	FALSE	1786854308	_scid_r	Md9zGE0sZ7sHD_uGMDe4eEFkP5m7x2fn-y_Ftw
.paramountplus.com	TRUE	/	TRUE	1820456311	_twpid	tw.1786759439005.456147508632741041
.paramountplus.com	TRUE	/	FALSE	1786850387	_uetsid	c75d83c0deb211f09a9789829fdb6b5e
.paramountplus.com	TRUE	/	FALSE	1820459987	_uetvid	e2571990953f11f088311560ef8da38b
.paramountplus.com	TRUE	/	FALSE	1821322424	ab.storage.deviceId.8cb8412e-2475-416f-b1df-c03199764b1f	%7B%22g%22%3A%22b134858c-0091-cedc-9584-245502c467f7%22%2C%22c%22%3A1786762424276%2C%22l%22%3A1786762424276%7D
.paramountplus.com	TRUE	/	FALSE	1821322430	AMCV_10D31225525FF5790A490D4D%40AdobeOrg	1585540135%7CMCMID%7C29945094167340356412254434504158086639%7CMCAAMLH-1787367230%7C7%7CMCAAMB-1787367230%7C6G1ynYcLPuiQxYZrsz_pkqfLG9yMXBpb2zX5dvJdYQJzPXImdj0y%7CMCOPTOUT-1786769630s%7CNONE%7CvVersion%7C4.4.0%7CMCCIDH%7C853120115
.paramountplus.com	TRUE	/	FALSE	1786854308	AMCVS_10D31225525FF5790A490D4D%40AdobeOrg	1
.paramountplus.com	TRUE	/	FALSE	1786854308	CBS_ADV_SUBSES_VAL	4
.paramountplus.com	TRUE	/	FALSE	1786854308	CBS_ADV_VAL	a
www.paramountplus.com	FALSE	/	FALSE	1787368782	CBS_ATTB	sl:g|ts:2026-08-15T03:19:41.656Z
www.paramountplus.com	FALSE	/	FALSE	1818298429	CBS_DEVICEID	29945094167340356412254434504158086639
www.paramountplus.com	FALSE	/	FALSE	1821322422	CBS_PID	63b75af7-0eb6-4edb-b607-86fd6693dff8
www.paramountplus.com	FALSE	/	FALSE	1818299972	CBS_ST	SUBSCRIBER
www.paramountplus.com	FALSE	/	FALSE	1818298422	CBS_U	ge:1|gr:7
www.paramountplus.com	FALSE	/	FALSE	1786848812	dmaInfo	528
.paramountplus.com	TRUE	/	FALSE	1786854308	ET_CID	undefined
www.paramountplus.com	FALSE	/	FALSE	1786799978	graph	%7B%22svod%22%3A%22WyJmLXNpZ25pbiIsIlwvYWNjb3VudFwvIixudWxsLDIsbnVsbCxudWxsXQ%3D%3D%22%2C%22cookieExpiration%22%3A1786799978%2C%22cookiePath%22%3A%22%5C%2F%22%7D
.paramountplus.com	TRUE	/	TRUE	1786854308	IR_3065	1786763987639%7C0%7C1786763987639%7C%7C
.paramountplus.com	TRUE	/	FALSE	1786854308	IR_gbd	paramountplus.com
.paramountplus.com	TRUE	/	FALSE	1786854308	jb	undefined
.paramountplus.com	TRUE	/	TRUE	1820887438	kndctr_10D31225525FF5790A490D4D_AdobeOrg_identity	CiYyOTk0NTA5NDE2NzM0MDM1NjQxMjI1NDQzNDUwNDE1ODA4NjYzOVIRCL2Dt4uWMxgBKgRJUkwxMAPwAcrBpZmANA%3D%3D
www.paramountplus.com	FALSE	/	FALSE	1786854308	optanonConsentValues	{"kidsFlag":"true","_optanonConsentPerformance":"1","_optanonConsentFunctional":"1","_optanonConsentMarketing":"1","_optanonConsentSocial":"1"}
www.paramountplus.com	FALSE	/	TRUE	1786854308	pxcts	rb6CHeFunIcoGtXv/lSnPIHxNMXOjG-2c/gZvs8XB1o=:hety8dGOp45zmEJlBuC209k0itJCaPKcUnMzoUF-dYIoX3T27bpx6PHqOBDcGrY3O3eIZ/o3chfvLeO23P3dlJy3fg-NpS2p4kaBuL9K7kxq/8Pgew8Gh7Lzo1Q4T-YTUGyslezpi57U6IB2oTD3B3ajoW5ZtJtn4-0FW7g0KLHOqeii7-yRMFejQkqzSB95
.paramountplus.com	TRUE	/	FALSE	1786854308	s_cc	true
.paramountplus.com	TRUE	/	FALSE	1786854308	s_fid	6F20547E89EBC4FD-399E14769966D619
www.paramountplus.com	FALSE	/	FALSE	1786848822	UP_NEW_SESSION	1
.paramountplus.com	TRUE	/	FALSE	1818299985	utag_main	v_id:0199616dacca0019a41bc1772a4e0506f002306700bd0$_sn:2$_se:27$_ss:0$_st:1786765785385$vapi_domain:paramountplus.com$_prevpage:%2Faccount%2F%3Bexp-1786767585635$ses_id:1786759437892%3Bexp-session$_pn:7%3Bexp-session
'''


def parse_netscape_cookie_file(raw_text: str) -> List[Dict[str, Any]]:
    """Parse a Netscape cookie file and return structured cookie dicts."""
    cookies: List[Dict[str, Any]] = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = [p.strip() for p in line.split('\t')]
        if len(parts) < 7:
            continue

        domain, flag, path, secure, expiry, name, value = parts[:7]
        cookies.append(
            {
                'domain': domain,
                'flag': flag,
                'path': path,
                'secure': secure.upper() == 'TRUE',
                'expiry': expiry,
                'name': name,
                'value': value,
            }
        )
    return cookies


def normalize_domain(domain: str) -> str:
    if not domain:
        return ''
    return domain.lower().lstrip('.')


def is_paramount_domain(domain: str) -> bool:
    d = normalize_domain(domain)
    return d in {'paramountplus.com', 'www.paramountplus.com'} or d.endswith('.paramountplus.com')


def choose_relevant_cookies(cookies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    relevant: List[Dict[str, Any]] = []
    for cookie in cookies:
        domain = cookie.get('domain', '')
        if is_paramount_domain(domain):
            relevant.append(cookie)
    return relevant


def get_proxy_url() -> Optional[str]:
    proxy = os.environ.get('PARAMOUNT_PROXY_URL') or os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if proxy:
        return proxy
    return 'http://6cd8mwsyja8a:1srkw2dwrpc126j@45.3.62.186:3129'


def build_session_with_cookies(cookies: List[Dict[str, Any]]) -> requests.Session:
    session = requests.Session()
    proxy_url = get_proxy_url()
    session.proxies.update({
        'http': proxy_url,
        'https': proxy_url,
    })
    session.headers.update(
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        }
    )

    for cookie in cookies:
        name = cookie.get('name', '')
        value = cookie.get('value', '')
        domain = cookie.get('domain', '')
        path = cookie.get('path', '/')
        if not name or not value:
            continue
        host = normalize_domain(domain)
        if not host:
            continue
        try:
            session.cookies.set(name, value, domain=host, path=path)
        except Exception:
            pass

    return session


def detect_login_page(url: str, html: str) -> bool:
    lower_url = url.lower()
    lower_html = html.lower()
    if 'signin' in lower_url or 'login' in lower_url:
        return True
    if 'sign in' in lower_html or 'log in' in lower_html or 'login' in lower_html:
        return True
    if 'watchlist' in lower_html and 'signin' in lower_html:
        return True
    return False


def extract_profiles_from_html(html: str) -> List[str]:
    names: List[str] = []
    if not html:
        return names

    account_profiles_match = re.search(r'"accountProfiles"\s*:\s*(\[.*?\])\s*(?:,\s*"[A-Za-z0-9_]+"|\s*\})', html, flags=re.S)
    if not account_profiles_match:
        # fallback: look for all "name" occurrences in the page and keep the profile-like ones
        for match in re.finditer(r'"name"\s*:\s*"((?:\\.|[^"\\])*)"', html):
            name = match.group(1).encode('utf-8').decode('unicode_escape')
            if name and name not in names and len(name) < 80:
                names.append(name)
        return names

    profiles_blob = account_profiles_match.group(1)
    for match in re.finditer(r'"name"\s*:\s*"((?:\\.|[^"\\])*)"', profiles_blob):
        name = match.group(1).encode('utf-8').decode('unicode_escape')
        if name and name not in names and len(name) < 80:
            names.append(name)

    return names


def extract_account_details_from_html(html: str) -> Dict[str, Any]:
    details: Dict[str, Any] = {
        'Paramount+ Plan': None,
        'Price': None,
        'Next Billing Date': None,
        'Payment Method': None,
    }

    if not html:
        return details

    def clean_text(value: str) -> str:
        value = htmlmod.unescape(value)
        value = value.replace('&nbsp;', ' ')
        value = re.sub(r'<.*?>', ' ', value, flags=re.S)
        value = re.sub(r'\s+', ' ', value)
        return value.strip()

    label_map = [
        ('Paramount+ Plan', 'Paramount+ Plan'),
        ('Price', 'Price'),
        ('Next Billing Date', 'Next Billing Date'),
        ('Payment Method', 'Payment Method'),
    ]

    # If the page does not clearly contain the actual account section, we do not invent values.
    found_any_label = False
    for label_text, _ in label_map:
        if label_text.lower() in html.lower():
            found_any_label = True
            break
    if not found_any_label:
        return details

    for label_text, output_key in label_map:
        label_pattern = re.compile(rf'(?is)<(?:label|div|span)[^>]*>\s*{re.escape(label_text)}\s*</(?:label|div|span)>')
        if not label_pattern.search(html):
            continue

        # find the value right after the label in the same row, excluding action buttons.
        row_pattern = re.compile(
            rf'(?is){re.escape(label_text)}\s*</(?:label|div|span)>\s*(?:<[^>]+>\s*)*(?:<div|<span|<p|<strong|<b)[^>]*>\s*(.*?)\s*(?:</(?:div|span|p|strong|b)>|<button|$)'
        )
        match = row_pattern.search(html)
        if not match:
            continue
        value = clean_text(match.group(1))
        if value and not any(keyword in value.lower() for keyword in ['edit plan', 'edit payment', 'switch to annual', 'redeem', 'save', 'gift card', 'coupon']):
            details[output_key] = value

    return details


def get_account_details_with_fallback(session: requests.Session) -> Dict[str, Any]:
    urls = [
        'https://www.paramountplus.com/account/',
        'https://www.paramountplus.com/account',
        'https://www.paramountplus.com/api/accounts/current/',
        'https://www.paramountplus.com/api/user/account/',
        'https://www.paramountplus.com/home/',
        'https://www.paramountplus.com/',
    ]

    for url in urls:
        try:
            headers = {}
            if '/account' in url:
                headers['Referer'] = 'https://www.paramountplus.com/user-profile/whos-watching/'
            
            account_response = session.get(url, timeout=20, allow_redirects=True, headers=headers)
            account_html = account_response.text
            
            # Skip cache errors
            if account_response.status_code == 403 and 'Varnish' in account_response.text:
                continue
            
            parsed = extract_account_details_from_html(account_html)
            if any(value is not None and str(value).strip() for value in parsed.values()):
                return parsed
        except (requests.RequestException, ValueError):
            continue

    return {
        'Paramount+ Plan': None,
        'Price': None,
        'Next Billing Date': None,
        'Payment Method': None,
    }


def log_debug(message: str) -> None:
    print(message, file=sys.stderr)


def get_account_details_via_selenium(cookies: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Load /account page via Selenium browser to bypass Varnish cache."""
    if not SELENIUM_AVAILABLE:
        log_debug("[LOG] Selenium non disponible, abandon du rendu via navigateur")
        return None
    
    try:
        log_debug("[LOG] Tentative de rendu de /account via Selenium...")
        
        # Initialiser le driver Chrome avec options headless
        proxy_url = get_proxy_url()
        options = webdriver.ChromeOptions()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        if proxy_url:
            options.add_argument(f'--proxy-server={proxy_url}')
        
        # Utiliser webdriver-manager pour gérer le driver
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        
        try:
            # Charger la page d'accueil d'abord pour définir les cookies
            driver.get('https://www.paramountplus.com/')
            time.sleep(2)
            
            # Ajouter les cookies au navigateur
            for cookie in cookies:
                domain = cookie.get('domain', '').lstrip('.')
                name = cookie.get('name', '')
                value = cookie.get('value', '')
                if not name or not value:
                    continue
                try:
                    driver.add_cookie({
                        'name': name,
                        'value': value,
                        'domain': domain if domain else 'www.paramountplus.com',
                        'path': cookie.get('path', '/'),
                    })
                except Exception as e:
                    log_debug(f"[LOG] Erreur ajout cookie {name}: {e}")
                    pass
            
            log_debug("[LOG] Cookies injectés dans le navigateur")
            time.sleep(1)
            
            # Naviguer vers /account
            account_url = 'https://www.paramountplus.com/account/'
            log_debug(f"[LOG] Navigation via Selenium vers: {account_url}")
            driver.get(account_url)
            
            # Attendre le chargement de la page
            WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.TAG_NAME, 'body')))
            time.sleep(2)
            
            account_html = driver.page_source
            log_debug(f"[LOG] Rendu /account via Selenium réussi: {len(account_html)} caractères")
            
            # Ne pas écrire de fichier HTML de débogage.
            
            # Extraire les données
            parsed_account = extract_account_details_from_html(account_html)
            has_data = any(value is not None and str(value).strip() for value in parsed_account.values())
            
            if has_data:
                log_debug(f"[LOG] Données account trouvées via Selenium: {parsed_account}")
                return parsed_account
            else:
                log_debug("[LOG] Pas de données account dans le rendu Selenium")
                return None
                
        finally:
            driver.quit()
            
    except NoSuchDriverException:
        log_debug("[LOG] WebDriver ChromeDriver non trouvé, abandon du rendu Selenium")
        return None
    except TimeoutException:
        log_debug("[LOG] Timeout lors du rendu Selenium")
        return None
    except Exception as e:
        log_debug(f"[LOG] Erreur lors du rendu Selenium: {type(e).__name__}: {e}")
        return None


def check_paramount_cookies(cookies: List[Dict[str, Any]]) -> Dict[str, Any]:
    relevant = choose_relevant_cookies(cookies)
    result: Dict[str, Any] = {
        'total_cookies': len(cookies),
        'relevant_cookies': len(relevant),
        'is_valid': False,
        'status': 'unknown',
        'message': '',
        'cookies': relevant,
        'checks': {},
        'profile_count': 0,
        'profile_names': [],
        'account_details': {
            'Paramount+ Plan': None,
            'Price': None,
            'Next Billing Date': None,
            'Payment Method': None,
        },
    }

    if not relevant:
        result['message'] = 'Aucun cookie Paramount+ valide trouvé dans le fichier.'
        result['status'] = 'invalid'
        return result

    session = build_session_with_cookies(relevant)
    
    # DEBUG: Afficher les cookies dans la session
    log_debug(f"\n[DEBUG] Cookies dans la session: {len(session.cookies)}")
    for cookie in session.cookies:
        log_debug(f"  - {cookie.name} = {cookie.value[:50]}..." if len(str(cookie.value)) > 50 else f"  - {cookie.name} = {cookie.value}")
    
    urls_to_test = [
        'https://www.paramountplus.com/',
        'https://www.paramountplus.com/account',
        'https://www.paramountplus.com/shows',
    ]

    for url in urls_to_test:
        try:
            r = session.get(url, timeout=15, allow_redirects=True)
            html = r.text[:4000]
            final_url = r.url.lower()
            is_login = detect_login_page(r.url, html)

            result['checks'][url] = {
                'status_code': r.status_code,
                'final_url': r.url,
                'login_like': is_login,
                'contains_watchlist': 'watchlist' in html.lower(),
            }

            if '/home' in final_url:
                profiles_url = 'https://www.paramountplus.com/user-profile/whos-watching/'
                try:
                    log_debug(f"[LOG] navigation vers profil: {profiles_url}")
                    profile_response = session.get(profiles_url, timeout=15, allow_redirects=True)
                    log_debug(f"[LOG] navigation vers profil reussie: status={profile_response.status_code}, url={profile_response.url}")
                    profile_html = profile_response.text
                    if profile_response.status_code == 200 and profile_html:
                        pass
                    profile_names = extract_profiles_from_html(profile_html)
                    log_debug(f"[LOG] recuperation des noms: {'OK' if profile_names else 'FAIL'} -> {profile_names}")
                    result['profile_count'] = len(profile_names)
                    result['profile_names'] = profile_names
                    result['profile_page_url'] = profile_response.url

                    account_url = 'https://www.paramountplus.com/account/'
                    log_debug(f"[LOG] navigation vers account: {account_url}")
                    # DEBUG: Vérifier les cookies de session avant la requête account
                    log_debug(f"[DEBUG] Cookies pour /account: {len(session.cookies)}")
                    cbs_st = session.cookies.get('CBS_ST')
                    log_debug(f"[DEBUG] CBS_ST cookie présent: {cbs_st is not None}")
                    
                    # Ajouter un délai et un referrer pour éviter le cache Varnish
                    time.sleep(1)
                    headers = {
                        'Referer': 'https://www.paramountplus.com/user-profile/whos-watching/',
                        'X-Requested-With': 'XMLHttpRequest',
                    }
                    account_response = session.get(account_url, timeout=20, allow_redirects=True, headers=headers)
                    account_html = account_response.text
                    
                    # DEBUG: En cas de 403, afficher la réponse
                    if account_response.status_code == 403:
                        log_debug(f"[DEBUG] 403 - Réponse partielle: {account_html[:500]}")
                    
                    parsed_account = extract_account_details_from_html(account_html)
                    has_account_data = any(value is not None and str(value).strip() for value in parsed_account.values())

                    log_debug(f"[LOG] navigation vers account reussie: status={account_response.status_code}, url={account_response.url}")
                    log_debug(f"[LOG] recuperation des infos account: {'OK' if has_account_data else 'FAIL'} -> {parsed_account}")

                    if account_response.status_code == 200 and account_html:
                        pass

                    if has_account_data:
                        result['account_details'] = parsed_account
                    else:
                        # Essayer Selenium si la requête directe a échoué
                        if account_response.status_code == 403:
                            log_debug('[LOG] Tentative de contournement du cache Varnish avec Selenium...')
                            selenium_result = get_account_details_via_selenium(relevant)
                            if selenium_result and any(value is not None and str(value).strip() for value in selenium_result.values()):
                                result['account_details'] = selenium_result
                                has_account_data = True
                        
                        if not has_account_data:
                            log_debug('[LOG] fallback account details via get_account_details_with_fallback')
                            result['account_details'] = get_account_details_with_fallback(session)
                            log_debug(f"[LOG] fallback account details: {result['account_details']}")

                    if profile_names:
                        result['is_valid'] = True
                        result['status'] = 'valid'
                        result['message'] = f'Les cookies sont valides. {len(profile_names)} profil(s) trouvé(s): {", ".join(profile_names)}'
                        return result
                except requests.RequestException as exc:
                    log_debug(f"[LOG] erreur navigation/recup: {exc}")
                    pass

            if '/account' in final_url:
                account_details = extract_account_details_from_html(r.text)
                result['account_details'] = account_details

            # Règle métier : tant qu'on n'est pas sur /home, la session n'est pas validée.
            if '/home' not in final_url:
                result['status'] = 'invalid'
                result['message'] = 'Session Paramount+ invalide : aucun /home détecté dans l’URL finale.'
                return result

            if r.status_code in (200, 302, 301) and not is_login:
                result['account_details'] = get_account_details_with_fallback(session)
                result['is_valid'] = True
                result['status'] = 'valid'
                result['message'] = 'Les cookies semblent valides pour Paramount+.'
                return result
        except requests.RequestException as exc:
            result['checks'][url] = {'error': str(exc)}

    result['status'] = 'invalid'
    result['message'] = 'Les cookies ne semblent pas être une session Paramount+ valide.'
    return result


def main() -> int:
    raw_stdin = sys.stdin.read()
    if raw_stdin.strip().startswith('{'):
        try:
            payload = json.loads(raw_stdin)
            cookies = payload.get('cookies', [])
            if isinstance(cookies, list):
                result = check_paramount_cookies(cookies)
                sys.stdout.write(json.dumps(result, ensure_ascii=False))
                return 0 if result['is_valid'] else 1
        except Exception:
            pass

    parser = argparse.ArgumentParser(description='Vérifie des cookies Paramount+ au format Netscape.')
    parser.add_argument('file', nargs='?', help='Fichier .txt contenant les cookies')
    parser.add_argument('--stdin', action='store_true', help='Lire les cookies depuis stdin')
    parser.add_argument('--sample', action='store_true', help='Utiliser un cookie d’exemple')
    args = parser.parse_args()

    if args.sample:
        raw_text = SAMPLE_COOKIE_TEXT
    elif args.stdin:
        raw_text = raw_stdin
    elif args.file:
        path = Path(args.file)
        if not path.exists():
            print(f'Fichier introuvable : {args.file}', file=sys.stderr)
            return 2
        raw_text = path.read_text(encoding='utf-8', errors='ignore')
    else:
        print('Aucune entrée fournie. Utilisez un fichier, --stdin ou --sample.', file=sys.stderr)
        return 2

    cookies = parse_netscape_cookie_file(raw_text)
    result = check_paramount_cookies(cookies)

    print(f"Cookies lus: {result['total_cookies']}")
    print(f"Cookies Paramount+: {result['relevant_cookies']}")
    print(f"Statut: {result['status']}")
    print(f"Message: {result['message']}")

    if result['is_valid']:
        print('[OK] Cookie Paramount+ probablement valide.')
    else:
        print('[FAIL] Cookie Paramount+ probablement invalide ou incomplet.')

    return 0 if result['is_valid'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
