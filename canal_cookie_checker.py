#!/usr/bin/env python3
"""CLI checker for a Canal+ Netscape cookie file.

The checker loads the cookie jar, requests the Canal+ homepage, follows
redirects, and writes the final URL, response metadata, request logs, and
HTML snapshot.  Cookie values are never printed or written to result files.

Usage:
    python canal_cookie_checker.py canal.txt
    python canal_cookie_checker.py canal.txt --output-dir my_results
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

DEFAULT_URL = "https://www.canalplus.com/tg/moncompte"
DEFAULT_OUTPUT_DIR = "canal_check_output"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
CANAL_DOMAINS = ("canalplus.com",)


# ---------------------------------------------------------------------------
# Cookie parsing
# ---------------------------------------------------------------------------

def parse_netscape_file(path: Path) -> list[dict[str, Any]]:
    """Parse a Netscape cookie file, honouring #HttpOnly_ prefixes."""
    parsed: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue

        http_only = line.startswith("#HttpOnly_")
        if http_only:
            line = line[len("#HttpOnly_"):]

        fields = line.split("\t")
        if len(fields) < 7:
            logging.warning("Ignoring malformed line %d", line_number)
            continue

        domain, include_subdomains, cookie_path, secure, expiry, name, value = fields[:7]
        if not name:
            logging.warning("Ignoring cookie without a name on line %d", line_number)
            continue

        parsed.append({
            "domain": domain,
            "include_subdomains": include_subdomains.upper() == "TRUE",
            "path": cookie_path or "/",
            "secure": secure.upper() == "TRUE",
            "expiry": expiry,
            "name": name,
            "value": value,
            "http_only": http_only,
        })
    return parsed


def is_canal_domain(domain: str) -> bool:
    normalized = domain.lower().lstrip(".")
    return normalized in CANAL_DOMAINS or normalized.endswith(".canalplus.com")


def add_cookies(session: requests.Session, cookies: list[dict[str, Any]]) -> int:
    """Add Canal+ cookies to a requests session and return the count."""
    added = 0
    for cookie in cookies:
        try:
            session.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie["domain"].lstrip("."),
                path=cookie["path"],
            )
            added += 1
        except Exception as exc:
            logging.warning("Could not add cookie %s: %s", cookie["name"], exc)
    return added


# ---------------------------------------------------------------------------
# HTML parsing
# ---------------------------------------------------------------------------

def parse_canal_html(html: str) -> dict[str, Any]:
    """Extract account / subscription details from Canal+ HTML page."""
    lower = html.lower()

    # ---- Page title -------------------------------------------------------
    title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    page_title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else None

    # ---- accountId (undefined = non connecté, valeur réelle = connecté) ---
    account_id_match = re.search(r'accountId[":\s]+([^,}\s"]+)', html)
    account_id_raw = account_id_match.group(1).strip() if account_id_match else None
    account_id = None if account_id_raw in (None, "undefined", "", "null") else account_id_raw

    # ---- microEligibility → offre abonné ----------------------------------
    eligibility_match = re.search(r'microEligibility[":\s]+"([^"]+)"', html)
    eligibility = eligibility_match.group(1) if eligibility_match else None
    offer_match = re.search(r'OFFER:\[([^\]]*)\]', eligibility or "")
    offer = offer_match.group(1) if offer_match and offer_match.group(1) else None

    # ---- Auth indicators --------------------------------------------------
    has_login_button = bool(re.search(r"(se\s+connecter|s'identifier|sign[\s-]?in)", lower))
    has_account_menu = bool(re.search(
        r'(mon\s+compte|mon\s+profil|espace\s+abonn|logout|se\s+d[ée]connecter|d[ée]connexion)',
        lower,
    ))

    # ---- passId / hodorKey ------------------------------------------------
    pass_id_present = bool(re.search(r'passId|p_pass_token', html, re.IGNORECASE))
    hodor_present   = bool(re.search(r'hodorKey', html, re.IGNORECASE))

    # ---- Profil / prénom --------------------------------------------------
    name_match = re.search(
        r'(?:firstName|first_name|prenom|displayName|display_name)["\s:=]+["\']([^"\'<>]{1,60})["\']',
        html, re.IGNORECASE,
    )

    # ---- Email ------------------------------------------------------------
    email_match = re.search(
        r'["\s]([\w.+%-]{2,64}@[\w.-]{2,253}\.[a-z]{2,})["\s]', html, re.IGNORECASE
    )

    return {
        "page_title":       page_title,
        "account_id":       account_id,
        "eligibility":      eligibility,
        "offer":            offer,
        "has_login_button": has_login_button,
        "has_account_menu": has_account_menu,
        "pass_id_present":  pass_id_present,
        "hodor_present":    hodor_present,
        "first_name":       name_match.group(1) if name_match else None,
        "email":            email_match.group(1) if email_match else None,
    }


# ---------------------------------------------------------------------------
# Core check
# ---------------------------------------------------------------------------

def check_cookie_file(
    cookie_file: Path,
    url: str,
    output_dir: Path,
    timeout: int,
    write_artifacts: bool = True,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path  = output_dir / "canal_check.log"
    html_path = output_dir / "canal_page.html"
    json_path = output_dir / "canal_result.json"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )

    # ------------------------------------------------------------------
    # 1. Parse cookies
    # ------------------------------------------------------------------
    logging.info("Loading cookie file: %s", cookie_file)
    all_cookies = parse_netscape_file(cookie_file)
    canal_cookies = [c for c in all_cookies if is_canal_domain(c["domain"])]
    logging.info(
        "Parsed %d total cookies; selected %d Canal+ cookies",
        len(all_cookies), len(canal_cookies),
    )

    # ------------------------------------------------------------------
    # 2. Build session & inject cookies
    # ------------------------------------------------------------------
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.canalplus.com/tg/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
    })
    added_count = add_cookies(session, canal_cookies)
    logging.info("Injected %d cookies into session", added_count)

    # ------------------------------------------------------------------
    # 3. Request page (avec reload : 2 requêtes successives)
    # ------------------------------------------------------------------
    logging.info("Requesting (first load): %s", url)
    session.get(url, allow_redirects=True, timeout=timeout)

    logging.info("Reloading (second request): %s", url)
    response = session.get(url, allow_redirects=True, timeout=timeout)

    for i, prev in enumerate(response.history, 1):
        location = prev.headers.get("Location", "–")
        logging.info("Redirect %d: %s %s → %s", i, prev.status_code, prev.url, location)

    logging.info("Final URL   : %s", response.url)
    logging.info("Status code : %s", response.status_code)

    # ------------------------------------------------------------------
    # 4. Save HTML snapshot
    # ------------------------------------------------------------------
    html = response.text or ""
    if write_artifacts:
        html_path.write_text(
            f"<!-- Final URL: {response.url} -->\n"
            f"<!-- Status: {response.status_code} -->\n"
            f"<!-- Cookies injected: {added_count} -->\n"
            + html,
            encoding="utf-8",
            errors="ignore",
        )
        logging.info("HTML snapshot saved → %s", html_path)

    # ------------------------------------------------------------------
    # 5. Parse & classify
    # ------------------------------------------------------------------
    account = parse_canal_html(html)

    # Valide si :
    #   - accountId présent et != undefined
    #   - OU page title contient "qui regarde" (sélecteur de profil = connecté)
    who_is_watching = bool(re.search(r'qui\s+regarde', (account["page_title"] or "").lower()))
    valid = (
        response.status_code == 200
        and (account["account_id"] is not None or who_is_watching)
    )

    result: dict[str, Any] = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "cookie_file": str(cookie_file),
        "url_tested": url,
        "final_url": response.url,
        "status_code": response.status_code,
        "valid": valid,
        "redirect_count": len(response.history),
        "parsed_cookie_count": len(all_cookies),
        "canal_cookie_count": len(canal_cookies),
        "injected_cookie_count": added_count,
        "html_length": len(html),
        "response_html_file": str(html_path),
        "log_file": str(log_path),
        "account": account,
    }

    if write_artifacts:
        json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        logging.info("JSON result  saved → %s", json_path)
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check a Canal+ Netscape cookie file",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "cookie_file",
        nargs="?",
        default="canal.txt",
        help="Path to the Netscape cookie file",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Canal+ URL to request")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Output directory")
    args = parser.parse_args()

    cookie_file = Path(args.cookie_file)
    if not cookie_file.is_file():
        print(f"[ERROR] Cookie file not found: {cookie_file}", file=sys.stderr)
        return 2

    try:
        result = check_cookie_file(cookie_file, args.url, Path(args.output_dir), args.timeout)
    except requests.RequestException as exc:
        logging.error("Request failed: %s", exc)
        return 2
    except OSError as exc:
        print(f"[ERROR] File error: {exc}", file=sys.stderr)
        return 2

    # ------------------------------------------------------------------
    # Pretty summary
    # ------------------------------------------------------------------
    account    = result["account"]
    status_ico = "✅ VALID" if result["valid"] else "❌ INVALID"

    print("\n" + "=" * 60)
    print(f"  CANAL+ COOKIE CHECK  —  {status_ico}")
    print("=" * 60)
    print(f"  Final URL    : {result['final_url']}")
    print(f"  HTTP status  : {result['status_code']}")
    print(f"  Redirects    : {result['redirect_count']}")
    print(f"  Cookies used : {result['injected_cookie_count']} / {result['canal_cookie_count']} canal")
    print("-" * 60)
    print(f"  Prénom       : {account['first_name'] or '—'}")
    print(f"  Email        : {account['email'] or '—'}")
    print(f"  Offre        : {account['offer'] or '—'}")
    print(f"  Menu compte  : {'oui' if account['has_account_menu'] else 'non'}")
    print(f"  Bouton login : {'oui' if account['has_login_button'] else 'non'}")
    print(f"  PassId       : {'présent' if account['pass_id_present'] else 'absent'}")
    print(f"  Page title   : {account['page_title'] or '—'}")
    print("=" * 60)
    print(f"  HTML  → {result['response_html_file']}")
    print(f"  JSON  → {str(Path(result['log_file']).parent / 'canal_result.json')}")
    print(f"  Log   → {result['log_file']}")
    print("=" * 60 + "\n")

    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
