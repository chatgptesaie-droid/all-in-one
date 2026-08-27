#!/usr/bin/env python3
"""Fetch the public Canal+ player configuration.

Examples:
    python canal_fetch.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

DEFAULT_URL = "https://player.canalplus.com/one/configs/v2/13/mycanalafr/prod.json"
DEFAULT_TOKEN_URL = "https://pass-api-v2.canal-plus.com/provider/services/cpafr-tg/public/createToken"
DEFAULT_HODOR_URL = "https://hodor.canalplus.pro/api/v2/mycanal/page/463d215e5c2555ce704ede224689e9d8/107248.json"
DEFAULT_PROFILES_URL = "https://hodor.canalplus.pro/api/v2/mycanal/me/Profiles"
DEFAULT_COOKIE_FILE = "canal.txt"
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.canalplus.com/",
    "Origin": "https://www.canalplus.com",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch the Canal+ player configuration")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--token-url", default=DEFAULT_TOKEN_URL)
    parser.add_argument("--hodor-url", default=DEFAULT_HODOR_URL)
    parser.add_argument("--profiles-url", default=DEFAULT_PROFILES_URL)
    parser.add_argument("--cookie-file", type=Path, default=Path(DEFAULT_COOKIE_FILE))
    parser.add_argument("--output", type=Path, help="Save the response body as JSON or text")
    parser.add_argument("--timeout", type=int, default=30)
    return parser.parse_args()


def extract_pass_id(cookie_file: Path) -> str | None:
    for raw_line in cookie_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) >= 7 and fields[5] == "passId":
            return fields[6]
    return None


def extract_account_fields(body: Any) -> dict[str, str | None]:
    wanted = ("Nom", "Offre", "N° de réabonnement", "Date d'échéance")
    extracted: dict[str, str | None] = {field: None for field in wanted}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("title") in extracted and "value" in value:
                extracted[value["title"]] = str(value["value"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(body)
    return extracted


def extract_profiles(body: Any) -> dict[str, Any]:
    profiles: list[str] = []

    contents = body.get("contents", []) if isinstance(body, dict) else []
    if isinstance(contents, list):
        for item in contents:
            if not isinstance(item, dict) or item.get("type") != "profile":
                continue
            aria_label = item.get("ariaLabel")
            if isinstance(aria_label, str) and aria_label.strip():
                profiles.append(aria_label.strip())

    return {"profile_count": len(profiles), "profiles": profiles}


def main() -> int:
    args = parse_args()
    try:
        pass_id = extract_pass_id(args.cookie_file)
    except OSError as error:
        print(f"Erreur lecture cookies: {error}", file=sys.stderr)
        return 1
    if not pass_id:
        print(f"Erreur: cookie passId introuvable dans {args.cookie_file}", file=sys.stderr)
        return 1

    try:
        response = requests.get(
            args.url,
            headers=DEFAULT_HEADERS,
            timeout=args.timeout,
        )
    except requests.RequestException as error:
        print(f"Erreur réseau: {error}", file=sys.stderr)
        return 1

    try:
        body: Any = response.json()
    except ValueError:
        body = None

    if isinstance(body, dict):
        portail_id = body.get("pass", {}).get("portailId") if isinstance(body.get("pass"), dict) else None
    else:
        portail_id = None

    if not response.ok or not portail_id:
        print(f"Erreur configuration Canal+: HTTP {response.status_code}", file=sys.stderr)
        return 1

    form_data = {
        "portailId": portail_id,
        "media": "web",
        "vect": "INTERNET",
        "passIdType": "pass",
        "noCache": "false",
        "passId": pass_id,
    }
    token_headers = {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": "*/*",
        "Accept-Language": DEFAULT_HEADERS["Accept-Language"],
        "Referer": "https://www.canalplus.com/",
        "Origin": "https://www.canalplus.com",
    }
    try:
        token_response = requests.post(
            args.token_url,
            data=form_data,
            headers=token_headers,
            timeout=args.timeout,
        )
    except requests.RequestException as error:
        print(f"Erreur réseau createToken: {error}", file=sys.stderr)
        return 1

    try:
        token_body: Any = token_response.json()
    except ValueError:
        token_body = None

    response_data = token_body.get("response", {}) if isinstance(token_body, dict) else {}
    pass_token = response_data.get("passToken") if isinstance(response_data, dict) else None
    parsed = {
        "portailId": portail_id,
        "passId": pass_id,
        "passToken": pass_token,
    }
    output = json.dumps(parsed, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(output, encoding="utf-8")
        print(f"Résultat sauvegardé: {args.output.resolve()}")
    else:
        print(output)
    if not token_response.ok or not pass_token:
        print(f"Erreur createToken: HTTP {token_response.status_code}", file=sys.stderr)
        return 1

    hodor_headers = {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": "*/*",
        "Accept-Language": DEFAULT_HEADERS["Accept-Language"],
        "Referer": "https://www.canalplus.com/",
        "Origin": "https://www.canalplus.com",
        "xx-operator": "pc",
        "xx-profile-id": "0",
        "tokenPass": pass_token,
    }
    try:
        hodor_response = requests.get(
            args.hodor_url,
            params={"aegon": "true", "featureToggles": "detailLight"},
            headers=hodor_headers,
            timeout=args.timeout,
        )
    except requests.RequestException as error:
        print(f"Erreur réseau Hodor: {error}", file=sys.stderr)
        return 1

    try:
        hodor_body: Any = hodor_response.json()
    except ValueError:
        hodor_body = None

    account_fields = extract_account_fields(hodor_body)
    hodor_output = json.dumps(account_fields, indent=2, ensure_ascii=False)

    hodor_path = args.output.with_name(f"{args.output.stem}_hodor{args.output.suffix}") if args.output else None
    print(hodor_output)
    if hodor_path:
        hodor_path.write_text(hodor_output, encoding="utf-8")
        print(f"Réponse Hodor sauvegardée: {hodor_path.resolve()}")

    print(f"Hodor HTTP: {hodor_response.status_code}", file=sys.stderr)

    try:
        profiles_response = requests.get(
            args.profiles_url,
            params={
                "displayTemplate": "profilesSelection",
                "allowedProfiles": "kids,adult",
                "profilesTemplateVersion": "2",
            },
            headers=hodor_headers,
            timeout=args.timeout,
        )
    except requests.RequestException as error:
        print(f"Erreur réseau Profiles: {error}", file=sys.stderr)
        return 1

    try:
        profiles_body: Any = profiles_response.json()
        profiles_output = json.dumps(extract_profiles(profiles_body), indent=2, ensure_ascii=False)
    except ValueError:
        profiles_output = profiles_response.text

    profiles_path = args.output.with_name(f"{args.output.stem}_profiles{args.output.suffix}") if args.output else None
    print(profiles_output)
    if profiles_path:
        profiles_path.write_text(profiles_output, encoding="utf-8")
        print(f"Réponse Profiles sauvegardée: {profiles_path.resolve()}")

    print(f"Profiles HTTP: {profiles_response.status_code}", file=sys.stderr)
    return 0 if hodor_response.ok and profiles_response.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
