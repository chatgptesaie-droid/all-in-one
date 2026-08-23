#!/usr/bin/env python3
"""Test the deployed Scribd Selenium API with a Netscape cookie file."""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_API = "https://netcookies-scribd-checker.onrender.com"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test the Render Scribd checker")
    parser.add_argument("cookie_file", type=Path, help="Path to a Netscape .txt cookie file")
    parser.add_argument("--url", default=DEFAULT_API, help=f"API URL (default: {DEFAULT_API})")
    parser.add_argument("--timeout", type=int, default=360, help="Request timeout in seconds")
    return parser.parse_args()


def parse_netscape(path: Path) -> tuple[list[dict[str, Any]], int]:
    cookies: list[dict[str, Any]] = []
    malformed = 0

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        line = raw_line.strip()
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]

        fields = line.split("\t")
        if len(fields) < 7 or not fields[5]:
            malformed += 1
            print(f"[WARN] Ligne cookie ignorée: {line_number}")
            continue

        domain, flag, cookie_path, secure, expiry, name, value = fields[:7]
        cookie: dict[str, Any] = {
            "domain": domain,
            "flag": flag,
            "path": cookie_path or "/",
            "secure": secure.upper() == "TRUE",
            "expiry": expiry,
            "name": name,
            "value": value,
        }
        cookies.append(cookie)

    return cookies, malformed


def request_json(url: str, payload: dict[str, Any] | None, timeout: int) -> tuple[int, Any, float]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            try:
                parsed: Any = json.loads(body)
            except json.JSONDecodeError:
                parsed = body
            return response.status, parsed, time.monotonic() - started
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        return error.code, parsed, time.monotonic() - started
    except Exception as error:
        return 0, {"error": f"{type(error).__name__}: {error}"}, time.monotonic() - started


def print_result(status: int, result: Any, duration: float) -> None:
    print(f"\n[RESULT] HTTP: {status or 'NETWORK_ERROR'} | Durée: {duration:.1f}s")
    if not isinstance(result, dict):
        print(result)
        return

    if result.get("error"):
        print(f"[ERROR] {result['error']}")
        return

    print(f"[STATUS] {'VALIDE' if result.get('valid') else 'INVALIDE'}")
    print(f"[URL] {result.get('final_url', '-')}")
    print(f"[COOKIES] parsés={result.get('parsed_cookie_count', '-')} | Scribd={result.get('scribd_cookie_count', '-')} | injectés={result.get('injected_cookie_count', '-')} | ignorés={result.get('skipped_cookie_count', '-')}")
    print(f"[HTML] {result.get('html_length', '-')} caractères")

    account = result.get("account") or {}
    if account:
        print("[ACCOUNT]")
        for key in ("email", "full_name", "username", "plan_type", "plan_tier", "plan_price", "order_state", "next_bill_date", "payment_type", "country", "is_subscriber"):
            if account.get(key) is not None:
                print(f"  {key}: {account[key]}")
    else:
        print("[ACCOUNT] aucune donnée extraite")

    print("\n[JSON COMPLET]")
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main() -> int:
    args = parse_args()
    api_url = args.url.rstrip("/")

    if not args.cookie_file.is_file():
        print(f"[ERROR] Fichier introuvable: {args.cookie_file}", file=sys.stderr)
        return 2

    try:
        cookies, malformed = parse_netscape(args.cookie_file)
    except OSError as error:
        print(f"[ERROR] Lecture impossible: {error}", file=sys.stderr)
        return 2

    scribd_count = sum(
        1 for cookie in cookies
        if cookie["domain"].lower().lstrip(".") == "scribd.com"
        or cookie["domain"].lower().lstrip(".").endswith(".scribd.com")
    )
    print(f"[FILE] {args.cookie_file}")
    print(f"[COOKIES] {len(cookies)} parsés | {scribd_count} Scribd | {malformed} lignes invalides")

    print(f"\n[HEALTH] {api_url}/health")
    health_status, health_result, health_duration = request_json(f"{api_url}/health", None, min(args.timeout, 30))
    print(f"HTTP: {health_status or 'NETWORK_ERROR'} | Durée: {health_duration:.1f}s | Réponse: {health_result}")
    if health_status != 200:
        print("[ERROR] Le serveur Render n'est pas disponible.", file=sys.stderr)
        return 1

    if not cookies:
        print("[ERROR] Aucun cookie Netscape valide à envoyer.", file=sys.stderr)
        return 2

    print(f"\n[VALIDATE] {api_url}/validate")
    status, result, duration = request_json(f"{api_url}/validate", {"cookies": cookies}, args.timeout)
    print_result(status, result, duration)
    return 0 if status == 200 and isinstance(result, dict) and result.get("valid") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
