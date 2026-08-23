#!/usr/bin/env python3
"""Request CapCut user credit data with a Netscape cookie file."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import requests

API_URL = "https://commerce-api-sg.capcut.com/commerce/v1/benefits/user_credit"
SUBSCRIPTION_URL = "https://commerce-api-sg.capcut.com/commerce/v1/subscription/user_info"
SUBSCRIPTION_INFOS_URL = "https://commerce-api-sg.capcut.com/commerce/v3/trade/subscription_infos"
ORIGIN = "https://www.capcut.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0"
DEFAULT_KEYWORDS = ("invalid", "expired", "unauthorized", "login", "auth", "vip", "subscription")


def parse_netscape_cookies(path: Path) -> list[dict[str, str]]:
    """Parse Netscape cookies, including #HttpOnly_ lines."""
    cookies: list[dict[str, str]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]

        fields = line.split("\t")
        if len(fields) < 7:
            logging.warning("Ignoring malformed cookie line %d", line_number)
            continue

        domain, _flag, cookie_path, _secure, _expiry, name, value = fields[:7]
        if domain.lower().lstrip(".").endswith("capcut.com") and name:
            cookies.append({
                "domain": domain,
                "path": cookie_path or "/",
                "name": name,
                "value": value,
            })
    return cookies


def create_session(cookies: list[dict[str, str]]) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
        "Content-Type": "application/json",
        "Origin": ORIGIN,
        "Referer": "https://www.capcut.com/",
        "appId": "348188",
        "loc": "TG",
        "lan": "fr-FR",
        "pf": "7",
        "appvr": "12.4.0",
        "tdid": "",
        "sign-ver": "1",
        "sign": "615e4b147637cb48acb5f4d56b94db28",
        "device-time": "1787236477",
        "web_id": "7676115960675583504",
        "did": "7676115960675583504",
        "store-country-code": "tg",
        "store-country-code-src": "uid",
    })
    for cookie in cookies:
        session.cookies.set(
            cookie["name"],
            cookie["value"],
            domain=cookie["domain"].lstrip("."),
            path=cookie["path"],
        )
    return session


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _find_values(value: Any, keys: tuple[str, ...]) -> list[str]:
    """Collect common API status/message fields without dumping the full response."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in keys and isinstance(item, (str, int, float, bool)):
                found.append(f"{key}={item}")
            found.extend(_find_values(item, keys))
    elif isinstance(value, list):
        for item in value:
            found.extend(_find_values(item, keys))
    return found


def _matched_keywords(value: Any, keywords: tuple[str, ...]) -> list[str]:
    text = json.dumps(value, ensure_ascii=False).lower()
    return [keyword for keyword in keywords if keyword.lower() in text]


def print_endpoint_status(name: str, result: dict[str, Any], keywords: tuple[str, ...]) -> None:
    body = result.get("response")
    status = result.get("status_code", "?")
    api_values = _find_values(body, ("code", "status", "message", "msg", "error", "error_code"))
    matches = _matched_keywords(body, keywords)
    print(f"\n[{name}]")
    print(f"  HTTP: {status}")
    print(f"  API: {', '.join(api_values) if api_values else 'aucun champ code/message détecté'}")
    print(f"  Mots-clés: {', '.join(matches) if matches else 'aucun'}")


def post_json(
    session: requests.Session,
    url: str,
    payload: dict[str, Any],
    timeout: int,
    name: str,
    keywords: tuple[str, ...],
) -> dict[str, Any]:
    """Send a CapCut JSON POST and normalize JSON/non-JSON responses."""
    logging.info("POST %s", url)
    response = session.post(url, json=payload, timeout=timeout)
    try:
        body: Any = response.json()
    except ValueError:
        body = {"raw_response": response.text}
    result = {
        "status_code": response.status_code,
        "url": response.url,
        "payload": payload,
        "response": body,
        "data_is_null": isinstance(body, dict) and body.get("data") is None,
    }
    print_endpoint_status(name, result, keywords)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch CapCut user credit JSON")
    parser.add_argument("cookie_file", nargs="?", default="cappcut_cookie.txt")
    parser.add_argument("--output", default="capcut_user_credit.json")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--sign", help="Override the request sign")
    parser.add_argument("--device-time", dest="device_time", help="Override device-time")
    parser.add_argument(
        "--keyword",
        action="append",
        dest="keywords",
        help="Mot-clé supplémentaire à rechercher dans chaque réponse (répétable)",
    )
    args = parser.parse_args()

    cookie_path = Path(args.cookie_file)
    if not cookie_path.is_file():
        print(f"Cookie file not found: {cookie_path}", file=sys.stderr)
        return 2

    cookies = parse_netscape_cookies(cookie_path)
    if not cookies:
        print("No CapCut cookies found", file=sys.stderr)
        return 2

    session = create_session(cookies)
    if args.sign:
        session.headers["sign"] = args.sign
    if args.device_time:
        session.headers["device-time"] = args.device_time

    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
    logging.info("Loaded %d CapCut cookies", len(cookies))
    keywords = tuple(dict.fromkeys(DEFAULT_KEYWORDS + tuple(args.keywords or [])))
    try:
        user_credit = post_json(session, API_URL, {}, args.timeout, "user_credit", keywords)
        subscription = post_json(
            session,
            SUBSCRIPTION_URL,
            {"aid": "348188", "scene": "vip"},
            args.timeout,
            "subscription_user_info",
            keywords,
        )
        subscription_infos = post_json(
            session,
            SUBSCRIPTION_INFOS_URL,
            {
                "scene": ["vip", "workspace"],
                "vip_levels": ["vip"],
                "app_id": 348188,
            },
            args.timeout,
            "subscription_infos",
            keywords,
        )
    except requests.RequestException as exc:
        logging.error("Request failed: %s", exc)
        return 2

    user_credit_data = _safe_dict(_safe_dict(user_credit["response"]).get("data"))
    subscription_data = _safe_dict(_safe_dict(subscription["response"]).get("data"))
    subscription_infos_data = _safe_dict(_safe_dict(subscription_infos["response"]).get("data"))
    is_valid = all(
        item["status_code"] < 400 and not item["data_is_null"]
        for item in (user_credit, subscription, subscription_infos)
    )
    result = {
        "is_valid": is_valid,
        "credit": user_credit_data.get("credit", {}),
        "workspace_subscribe_info": subscription_data.get("workspace_subscribe_info", {}),
        "subscription_user_infos": subscription_infos_data.get("subscription_user_infos", {}),
    }
    Path(args.output).write_text(
        json.dumps(result, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\nSaved JSON: {args.output}")
    return 0 if result["is_valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
