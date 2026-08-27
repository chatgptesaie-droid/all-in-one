#!/usr/bin/env python3
"""Combined Canal+ checker.

Runs canal_cookie_checker first, then fetches portailId, creates passToken,
and requests the account page and profiles endpoint. All artifacts share the
same output directory and the existing canal_check.log format.

Usage:
    python canal_combined_checker.py canal.txt
    python canal_combined_checker.py canal.txt --output-dir canal_check_output
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import requests

from canal_cookie_checker import DEFAULT_URL as ACCOUNT_URL
from canal_cookie_checker import check_cookie_file
from canal_fetch import (
    DEFAULT_HEADERS,
    DEFAULT_HODOR_URL,
    DEFAULT_PROFILES_URL,
    DEFAULT_TOKEN_URL,
    extract_account_fields,
    extract_pass_id,
    extract_profiles,
)

CONFIG_URL = "https://player.canalplus.com/one/configs/v2/13/mycanalafr/prod.json"


def fetch_json(
    session: requests.Session,
    method: str,
    url: str,
    timeout: int,
    **kwargs: Any,
) -> tuple[requests.Response, Any]:
    response = session.request(method, url, timeout=timeout, **kwargs)
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    return response, body


def run_combined(
    cookie_file: Path,
    output_dir: Path,
    timeout: int,
    token_url: str,
    hodor_url: str,
    profiles_url: str,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)

    logging.info("Starting combined Canal+ check")
    cookie_result = check_cookie_file(cookie_file, ACCOUNT_URL, output_dir, timeout, write_artifacts=False)

    pass_id = extract_pass_id(cookie_file)
    if not pass_id:
        raise ValueError(f"Cookie passId introuvable dans {cookie_file}")
    logging.info("passId found in cookie file")

    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)

    logging.info("Requesting player configuration: %s", CONFIG_URL)
    config_response, config_body = fetch_json(session, "GET", CONFIG_URL, timeout)
    if not config_response.ok or not isinstance(config_body, dict):
        raise RuntimeError(f"Configuration Canal+ HTTP {config_response.status_code}")

    pass_config = config_body.get("pass")
    portail_id = pass_config.get("portailId") if isinstance(pass_config, dict) else None
    if not portail_id:
        raise RuntimeError("portailId introuvable dans la configuration Canal+")
    logging.info("portailId extracted")

    token_headers = {
        **DEFAULT_HEADERS,
        "Accept": "*/*",
    }
    logging.info("Requesting createToken")
    token_response, token_body = fetch_json(
        session,
        "POST",
        token_url,
        timeout,
        headers=token_headers,
        data={
            "portailId": portail_id,
            "media": "web",
            "vect": "INTERNET",
            "passIdType": "pass",
            "noCache": "false",
            "passId": pass_id,
        },
    )
    response_data = token_body.get("response", {}) if isinstance(token_body, dict) else {}
    pass_token = response_data.get("passToken") if isinstance(response_data, dict) else None
    if not token_response.ok or not pass_token:
        raise RuntimeError(f"createToken HTTP {token_response.status_code}")
    logging.info("passToken received")

    auth_headers = {
        **token_headers,
        "xx-operator": "pc",
        "xx-profile-id": "0",
        "tokenPass": pass_token,
    }

    logging.info("Requesting Hodor account page: %s", hodor_url)
    hodor_response, hodor_body = fetch_json(
        session,
        "GET",
        hodor_url,
        timeout,
        headers=auth_headers,
        params={"aegon": "true", "featureToggles": "detailLight"},
    )
    account_fields = extract_account_fields(hodor_body)
    logging.info("Hodor account fields extracted")

    logging.info("Requesting Canal+ profiles: %s", profiles_url)
    profiles_response, profiles_body = fetch_json(
        session,
        "GET",
        profiles_url,
        timeout,
        headers=auth_headers,
        params={
            "displayTemplate": "profilesSelection",
            "allowedProfiles": "kids,adult",
            "profilesTemplateVersion": "2",
        },
    )
    profiles = extract_profiles(profiles_body)
    logging.info("Profiles extracted: %d profiles", profiles["profile_count"])

    tokens = {
        "portailId": portail_id,
        "passId": pass_id,
        "passToken": pass_token,
    }
    combined = {
        "cookie_check": cookie_result,
        "tokens": tokens,
        "account": account_fields,
        "profiles": profiles,
        "http": {
            "config": config_response.status_code,
            "createToken": token_response.status_code,
            "hodor": hodor_response.status_code,
            "profiles": profiles_response.status_code,
        },
    }
    return combined


def main() -> int:
    parser = argparse.ArgumentParser(description="Combined Canal+ cookie and account checker")
    parser.add_argument("cookie_file", nargs="?", default="canal.txt")
    parser.add_argument("--output-dir", default="canal_check_output")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--token-url", default=DEFAULT_TOKEN_URL)
    parser.add_argument("--hodor-url", default=DEFAULT_HODOR_URL)
    parser.add_argument("--profiles-url", default=DEFAULT_PROFILES_URL)
    args = parser.parse_args()

    cookie_file = Path(args.cookie_file)
    output_dir = Path(args.output_dir)
    if not cookie_file.is_file():
        print(f"[ERROR] Cookie file not found: {cookie_file}")
        return 2

    try:
        # canal_cookie_checker configures the shared canal_check.log handler.
        result = run_combined(
            cookie_file,
            output_dir,
            args.timeout,
            args.token_url,
            args.hodor_url,
            args.profiles_url,
        )
    except (OSError, requests.RequestException, RuntimeError, ValueError) as error:
        logging.error("Combined Canal+ check failed: %s", error)
        return 2

    account = result["account"]
    profiles = result["profiles"]
    print("\n" + "=" * 60)
    print(f"  CANAL+ COOKIE CHECK — {'VALID' if result['cookie_check']['valid'] else 'INVALID'}")
    print("=" * 60)
    print(f"  Nom                  : {account.get('Nom') or '—'}")
    print(f"  Offre                : {account.get('Offre') or '—'}")
    print(f"  N° de réabonnement   : {account.get('N° de réabonnement') or '—'}")
    print(f"  Date d'échéance      : {account.get("Date d'échéance") or '—'}")
    print(f"  Profils ({profiles['profile_count']})       : {', '.join(profiles['profiles']) or '—'}")
    print("-" * 60)
    print(f"  Logs                 : {output_dir / 'canal_check.log'}")
    print("  Aucun fichier HTML/JSON intermédiaire créé")
    print("=" * 60)
    return 0 if result["cookie_check"]["valid"] and result["http"]["hodor"] == 200 and result["http"]["profiles"] == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
