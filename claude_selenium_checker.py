#!/usr/bin/env python3
"""Validate Claude cookie blocks with a visible Selenium browser."""
from __future__ import annotations

import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

CLAUDE_HOME = "https://claude.ai/"
CLAUDE_SETTINGS = "https://claude.ai/settings/billing"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"


def find_chrome() -> str | None:
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    return None


def get_cookie_map(cookies: list[dict[str, Any]]) -> dict[str, str]:
    return {
        str(cookie.get("name")): str(cookie.get("value"))
        for cookie in cookies
        if cookie.get("name") and cookie.get("value")
    }


def add_cookies(driver: uc.Chrome, cookies: list[dict[str, Any]]) -> int:
    added = 0
    for cookie in cookies:
        name = cookie.get("name", "")
        value = cookie.get("value", "")
        if not name or not value:
            continue
        item: dict[str, Any] = {
            "name": name,
            "value": value,
            "path": cookie.get("path") or "/",
        }
        domain = str(cookie.get("domain", ""))
        if domain.lower().lstrip(".") in ("claude.ai", "www.claude.ai"):
            item["domain"] = domain.lstrip(".")
        expiry = str(cookie.get("expiry", ""))
        if expiry.isdigit() and int(expiry) > 0:
            item["expiry"] = int(expiry)
        try:
            driver.add_cookie(item)
            added += 1
        except Exception:
            pass
    return added


def wait_render(driver: uc.Chrome, timeout: int = 30) -> None:
    try:
        WebDriverWait(driver, timeout).until(
            lambda current: len(current.find_element(By.TAG_NAME, "body").get_attribute("innerHTML") or "") > 500
        )
    except Exception:
        pass
    time.sleep(2)


def extract_plan_from_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    match = re.search(r"Forfait\s+(Free|Pro|Team|Enterprise)\b", text, re.IGNORECASE)
    if match:
        return re.sub(r"\s+", " ", match.group(0)).strip()
    if re.search(r"Upgrade\s+to\s+Pro|Mettre\s+à\s+niveau", text, re.IGNORECASE):
        return "Forfait Free"
    return "Forfait Pro"


def dump_new_page(driver: uc.Chrome) -> str | None:
    if "/new" not in driver.current_url.lower():
        return None
    dump_dir = Path(os.environ.get("CLAUDE_DUMP_DIR", "claude_check_output"))
    dump_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dump_path = dump_dir / f"claude_new_{timestamp}.html"
    dump_path.write_text(driver.page_source or "", encoding="utf-8", errors="ignore")
    print(f"[Claude] Page /new détectée, HTML sauvegardé: {dump_path}")
    return str(dump_path)


def fetch_bootstrap_in_browser(driver: uc.Chrome, org_id: str, timeout: int) -> dict[str, Any]:
    url = (
        f"https://claude.ai/edge-api/bootstrap/{org_id}/app_start"
        "?statsig_hashing_algorithm=djb2&growthbook_format=sdk"
        "&cache_bust=1&include_system_prompts=false"
    )
    script = """
        const [url, timeoutMs, done] = arguments;
        const timer = setTimeout(() => done({status: 0, body: null, error: 'timeout'}), timeoutMs);
        fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': '*/*',
                'anthropic-client-platform': 'web_claude_ai',
                'anthropic-client-version': '1.0.0'
            }
        }).then(async (response) => {
            clearTimeout(timer);
            let body = null;
            try { body = await response.json(); } catch (_) {}
            done({status: response.status, body});
        }).catch((error) => {
            clearTimeout(timer);
            done({status: 0, body: null, error: String(error)});
        });
    """
    result = driver.execute_async_script(script, url, timeout * 1000)
    if not isinstance(result, dict):
        raise RuntimeError("Réponse bootstrap Selenium invalide")
    return result


def check(cookies: list[dict[str, Any]], timeout: int = 30) -> dict[str, Any]:
    cookie_map = get_cookie_map(cookies)
    org_id = cookie_map.get("lastActiveOrg")
    result: dict[str, Any] = {
        "is_valid": False,
        "email": "-",
        "name": "-",
        "uuid": "-",
        "plan": "-",
        "rate_upsell": "-",
        "org_name": "-",
        "org_id": org_id or "-",
        "features": [],
        "injected_count": 0,
        "final_url": "",
        "message": "",
    }
    if not org_id:
        result["message"] = "Cookie lastActiveOrg introuvable"
        return result

    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument(f"--user-agent={USER_AGENT}")
    chrome_binary = find_chrome()
    if chrome_binary:
        options.binary_location = chrome_binary

    # Visible locally by default. Set CLAUDE_HEADLESS=true for a server/container.
    headless = os.environ.get("CLAUDE_HEADLESS", "true").lower() in {"1", "true", "yes"}
    if headless:
        options.add_argument("--headless=new")

    driver = None
    try:
        driver = uc.Chrome(options=options, headless=headless, version_main=151)
        driver.set_page_load_timeout(timeout)
        print("[Claude] Ouverture de Claude dans Chrome...")
        driver.get(CLAUDE_HOME)
        time.sleep(2)
        result["injected_count"] = add_cookies(driver, cookies)
        print(f"[Claude] Cookies injectés: {result['injected_count']}")
        driver.get(CLAUDE_HOME)
        wait_render(driver, timeout)
        result["final_url"] = driver.current_url
        result["plan"] = extract_plan_from_html(driver.page_source or "")
        new_page_dump = dump_new_page(driver)
        if new_page_dump:
            result["new_page_html"] = new_page_dump
        bootstrap = fetch_bootstrap_in_browser(driver, org_id, timeout)
        if bootstrap.get("status") != 200:
            result["message"] = f"HTTP {bootstrap.get('status', 0)} — session Claude invalide"
            return result

        payload = bootstrap.get("body") or {}
        account = payload.get("account") or {}
        memberships = account.get("memberships") or []
        membership = memberships[0] if memberships else {}
        organization = membership.get("organization") or {}
        rate_upsell = organization.get("rate_limit_upsell") or ""
        seat_tier = membership.get("seat_tier") or organization.get("plan_tier")
        billing_type = organization.get("billing_type")
        if seat_tier:
            plan = seat_tier
        elif billing_type:
            plan = billing_type
        elif rate_upsell == "upgrade_to_pro":
            plan = "FREE"
        elif not rate_upsell:
            plan = "PRO"
        else:
            plan = rate_upsell
        features = [
            feature.get("feature")
            for feature in (payload.get("current_user_access") or {}).get("features", [])
            if isinstance(feature, dict) and feature.get("feature")
        ][:10]

        driver.get(CLAUDE_SETTINGS)
        wait_render(driver, timeout)
        result.update({
            "email": account.get("email_address") or "-",
            "name": account.get("full_name") or account.get("display_name") or "-",
            "uuid": account.get("uuid") or "-",
            "plan": result["plan"] or plan,
            "rate_upsell": rate_upsell or "-",
            "org_name": organization.get("name") or "-",
            "features": features,
        })
        result["is_valid"] = bool(account.get("email_address"))
        result["message"] = "Cookie Claude valide" if result["is_valid"] else "Session Claude invalide"
        return result
    except Exception as error:
        result["message"] = f"Erreur Selenium: {type(error).__name__}: {error}"
        return result
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
