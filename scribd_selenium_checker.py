#!/usr/bin/env python3
"""CLI checker for a Scribd Netscape cookie file using undetected-chromedriver.

Workflow:
  1. Open https://www.scribd.com/ with undetected Chrome
  2. Inject all Scribd cookies
  3. Reload → must redirect to /home  (validity check)
  4. Navigate to /your-account → parse rich account data
  5. Dump HTML snapshots + JSON result

Cookie values are never printed.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

DEFAULT_URL       = "https://www.scribd.com/"
VALID_PATH_FRAGMENT = "/home"
ACCOUNT_PATH      = "/your-account"
DEFAULT_OUTPUT_DIR = "scribd_check_output"


# ---------------------------------------------------------------------------
# Cookie parsing
# ---------------------------------------------------------------------------

def parse_netscape_file(path: Path) -> list[dict[str, Any]]:
    """Parse a Netscape cookie file, including #HttpOnly_ prefixed lines."""
    parsed: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#") and not line.startswith("#HttpOnly_"):
            continue

        http_only = line.startswith("#HttpOnly_")
        if http_only:
            line = line[len("#HttpOnly_"):]

        fields = line.split("\t")
        if len(fields) < 7:
            logging.warning("Ignoring malformed line %d (got %d fields)", line_number, len(fields))
            continue

        domain, _, cookie_path, secure, expiry, name, value = fields[:7]
        if not name:
            logging.warning("Ignoring cookie without a name on line %d", line_number)
            continue

        cookie: dict[str, Any] = {
            "name":     name,
            "value":    value,
            "domain":   domain if domain.startswith(".") else domain,
            "path":     cookie_path or "/",
            "secure":   secure.upper() == "TRUE",
            "httpOnly": http_only,
        }
        if expiry.isdigit():
            cookie["expiry"] = int(expiry)
        parsed.append(cookie)
    return parsed


def is_scribd_domain(domain: str) -> bool:
    normalized = domain.lower().lstrip(".")
    return normalized == "scribd.com" or normalized.endswith(".scribd.com")


# ---------------------------------------------------------------------------
# HTML analysis
# ---------------------------------------------------------------------------

def auth_indicators(html: str) -> dict[str, bool]:
    lower = html.lower()
    return {
        "has_login_text":   any(t in lower for t in ("log in", "login", "sign in", "connexion")),
        "has_account_text": any(t in lower for t in ("my account", "mon compte", "profile", "dashboard")),
        "has_scribd_shell": "scribd" in lower,
    }


def parse_scribd_your_account_html(html: str) -> dict[str, Any]:
    """Extract rich account data from /your-account page.

    Two sources:
    1. Hypernova JSON blob embedded as  <!--{...}-->
    2. DOM fallbacks  (data-testid / data-e2e attributes)
    """
    data: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 1. Hypernova JSON blob
    # ------------------------------------------------------------------
    json_match = re.search(
        r'<!--(\{"accountManagement".*?\})-->',
        html,
        re.DOTALL,
    )
    if json_match:
        try:
            blob = json.loads(json_match.group(1))
            am       = blob.get("accountManagement", {})
            user     = blob.get("user", {})
            order    = am.get("orderInfo", {})
            pay      = am.get("paymentInfo", {})
            auth     = am.get("authentication", {})
            last_inv = order.get("lastInvoiceData", {})

            data["user_id"]           = str(user.get("id", "")) or None
            data["full_name"]         = user.get("name") or last_inv.get("billingName")
            data["username"]          = user.get("username")

            # Primary email
            emails = user.get("emailAddresses", [])
            primary = next((e["email"] for e in emails if e.get("primary")), None)
            data["email"] = (
                primary
                or last_inv.get("billingEmail")
                or auth.get("pageGateEnrolledEmail")
            )

            data["order_state"]        = order.get("orderState")
            data["plan_type"]          = user.get("currentPlan", {}).get("type")
            data["plan_tier"]          = user.get("currentPlan", {}).get("tier")
            data["plan_interval"]      = user.get("currentPlan", {}).get("interval")
            data["plan_price"]         = user.get("currentPlan", {}).get("price")
            data["next_bill_date"]     = user.get("nextPaymentDate") or order.get("nextBillDate")
            data["payment_type"]       = pay.get("paymentType")
            data["payment_method"]     = pay.get("paymentMethod")
            data["last_invoice_total"] = last_inv.get("totalAmountWithTax")
            data["last_invoice_date"]  = last_inv.get("invoicePaidDate")
            data["country"]            = user.get("country")
            data["is_subscriber"]      = user.get("isSubscriber")
            data["is_trialing"]        = user.get("isTrialing")
            data["is_paused"]          = user.get("isPaused")
        except Exception as exc:
            logging.warning("JSON blob parse error: %s", exc)

    # ------------------------------------------------------------------
    # 2. DOM fallbacks
    # ------------------------------------------------------------------
    if not data.get("email"):
        m = re.search(r'data-testid=["\']email["\'][^>]*>([^<]+)<', html, re.IGNORECASE)
        if m:
            data["email"] = m.group(1).strip()

    if not data.get("next_bill_date"):
        m = re.search(r'data-e2e=["\']renewal_date["\'][^>]*>([^<]+)<', html, re.IGNORECASE)
        if m:
            data["next_bill_date"] = m.group(1).strip()

    if not data.get("last_invoice_total"):
        m = re.search(r'data-testid=["\']price["\'][^>]*>([^<]+)<', html, re.IGNORECASE)
        if m:
            data["last_invoice_total"] = m.group(1).strip()

    # Page title
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    data["page_title"] = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else None

    return data


# ---------------------------------------------------------------------------
# Wait helper
# ---------------------------------------------------------------------------

def wait_for_render(driver: uc.Chrome, timeout: int = 20) -> None:
    """Wait until the page body has meaningful content."""
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: len(d.find_element(By.TAG_NAME, "body").get_attribute("innerHTML") or "") > 1000
        )
        time.sleep(3)
    except Exception:
        logging.warning("Render timeout — dumping current page state")
        time.sleep(2)


# ---------------------------------------------------------------------------
# Core checker
# ---------------------------------------------------------------------------

def check_cookie_file(
    cookie_file: Path,
    url: str,
    output_dir: Path,
    timeout: int,
    headless: bool,
    chrome_version: int | None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path  = output_dir / "scribd_check.log"
    json_path = output_dir / "scribd_result.json"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )

    logging.info("Loading cookie file: %s", cookie_file)
    all_cookies    = parse_netscape_file(cookie_file)
    scribd_cookies = [c for c in all_cookies if is_scribd_domain(c["domain"])]
    logging.info(
        "Parsed %d cookies total; selected %d Scribd cookies",
        len(all_cookies), len(scribd_cookies),
    )

    # ------------------------------------------------------------------
    # Launch undetected Chrome
    # ------------------------------------------------------------------
    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")

    chrome_binary = next(
        (
            shutil.which(name)
            for name in ("chromium", "chromium-browser", "google-chrome")
            if shutil.which(name)
        ),
        None,
    )
    if chrome_binary:
        opts.binary_location = chrome_binary
    else:
        raise RuntimeError("Chrome/Chromium introuvable dans l'environnement du serveur")

    uc_kwargs: dict[str, Any] = {
        "options":      opts,
        "headless":     headless,
        "version_main": chrome_version if chrome_version else 151,
    }

    logging.info("Launching undetected Chrome (headless=%s)", headless)
    driver = uc.Chrome(**uc_kwargs)

    try:
        # 1. Open domain
        logging.info("Loading initial page: %s", url)
        driver.get(url)
        time.sleep(3)

        # 2. Inject cookies
        injected = skipped = 0
        for c in scribd_cookies:
            try:
                driver.add_cookie(c)
                injected += 1
            except Exception as exc:
                logging.warning("Skipping cookie %s: %s", c["name"], exc)
                skipped += 1
        logging.info("Injected %d cookies (%d skipped)", injected, skipped)

        # 3. Reload → should redirect to /home
        logging.info("Reloading after injection ...")
        driver.get(url)
        wait_for_render(driver, timeout=timeout)

        final_url = driver.current_url
        html      = driver.page_source or ""
        logging.info("Final URL : %s  (%d chars)", final_url, len(html))

        # 4. Validity
        valid = VALID_PATH_FRAGMENT in final_url

        # 5. /your-account  →  rich data
        acc_data: dict[str, Any] = {}
        if valid:
            # Build account URL from the base of the final URL
            # e.g. https://fr.scribd.com/home → https://fr.scribd.com/your-account
            base = final_url.split("/home")[0]
            acc_url = base + ACCOUNT_PATH
            logging.info("Navigating to %s", acc_url)
            driver.get(acc_url)
            wait_for_render(driver, timeout=timeout)

            acc_html = driver.page_source or ""
            logging.info("Account page HTML: %d chars", len(acc_html))
            acc_data = parse_scribd_your_account_html(acc_html)

        # 6. Build result
        result = {
            "checked_at":            datetime.now(timezone.utc).isoformat(),
            "cookie_file":           str(cookie_file),
            "url_tested":            url,
            "final_url":             final_url,
            "valid":                 valid,
            "redirected_to_home":    valid,
            "parsed_cookie_count":   len(all_cookies),
            "scribd_cookie_count":   len(scribd_cookies),
            "injected_cookie_count": injected,
            "skipped_cookie_count":  skipped,
            "html_length":           len(html),
            "response_html_file":    None,
            "account_html_file":     None,
            "log_file":              str(log_path),
            "indicators":            auth_indicators(html),
            "account":               acc_data,
        }

        json_path.write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        logging.info("JSON result saved: %s", json_path)
        return result

    finally:
        try:
            driver.quit()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check a Scribd Netscape cookie file via undetected Chrome",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("cookie_file", nargs="?", default="scribd.txt")
    parser.add_argument("--url",            default=DEFAULT_URL)
    parser.add_argument("--timeout",        type=int, default=20)
    parser.add_argument("--output-dir",     default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--no-headless",    action="store_true")
    parser.add_argument("--chrome-version", type=int, default=None)
    args = parser.parse_args()

    cookie_file = Path(args.cookie_file)
    if not cookie_file.is_file():
        print(f"Cookie file not found: {cookie_file}", file=sys.stderr)
        return 2

    try:
        result = check_cookie_file(
            cookie_file, args.url,
            Path(args.output_dir), args.timeout,
            headless=not args.no_headless,
            chrome_version=args.chrome_version,
        )
    except Exception as exc:
        logging.error("Checker failed: %s", exc, exc_info=True)
        return 2

    acc = result.get("account", {})
    print("\n" + "=" * 60)
    print("RESULT   :", "✓ VALID" if result["valid"] else "✗ INVALID")
    print("Final URL:", result["final_url"])
    if acc.get("email"):
        print("Email    :", acc["email"])
    if acc.get("full_name"):
        print("Name     :", acc["full_name"])
    if acc.get("username"):
        print("Username :", acc["username"])
    if acc.get("plan_type"):
        print("Plan     :", acc["plan_type"], "|", acc.get("plan_price", ""))
    if acc.get("order_state"):
        print("Status   :", acc["order_state"])
    if acc.get("next_bill_date"):
        print("Next bill:", acc["next_bill_date"])
    if acc.get("payment_type"):
        print("Payment  :", acc["payment_type"], acc.get("payment_method", ""))
    print("=" * 60)
    print("\nFull JSON:")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
