#!/usr/bin/env python3
"""
Claude multi-cookie checker.

Le fichier d'entrée peut contenir plusieurs blocs Netscape cookie
(séparés par une ligne '# Netscape HTTP Cookie File').

Pour chaque bloc → appel /edge-api/bootstrap/{org_id}/app_start
Résultat → JSON  { "cookie_1": {...}, "cookie_2": {...}, ... }

Usage:
    python claude_checker_multi.py cookies.txt
    python claude_checker_multi.py cookies.txt --output results.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"
)


# ---------------------------------------------------------------------------
# Cookie parsing
# ---------------------------------------------------------------------------

def split_cookie_blocks(text: str) -> list[str]:
    """Split a file containing multiple Netscape cookie blocks."""
    blocks = []
    current: list[str] = []

    def flush() -> None:
        if current and parse_block("\n".join(current)):
            blocks.append("\n".join(current))

    for line in text.splitlines():
        stripped = line.strip()
        if (
            stripped == "# Netscape HTTP Cookie File"
            or stripped.startswith("FILE:")
            or (stripped.startswith("# ---") and stripped.endswith("---"))
        ):
            flush()
            current = [line] if stripped == "# Netscape HTTP Cookie File" else []
        else:
            current.append(line)
    if current:
        flush()
    return blocks


def parse_block(block: str) -> dict[str, str]:
    """Parse one Netscape block → {name: value}."""
    cookies: dict[str, str] = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or (line.startswith("#") and not line.startswith("#HttpOnly_")):
            continue
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        fields = line.split("\t")
        if len(fields) < 7:
            continue
        name, value = fields[5], fields[6]
        if name and value:
            cookies[name] = value
    return cookies


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------

def check_one(cookies: dict[str, str], timeout: int = 20) -> dict:
    """Check a single cookie dict via the bootstrap API."""
    org_id = cookies.get("lastActiveOrg", "")
    if not org_id:
        return {"error": "lastActiveOrg cookie not found"}

    cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())

    session = requests.Session()
    session.headers.update({
        "User-Agent":                USER_AGENT,
        "Accept":                    "*/*",
        "Accept-Language":           "fr-FR",
        "Referer":                   "https://claude.ai/settings/billing",
        "Cookie":                    cookie_header,
        "anthropic-client-platform": "web_claude_ai",
        "anthropic-client-version":  "1.0.0",
        "anthropic-device-id":       cookies.get("anthropic-device-id", ""),
        "anthropic-anonymous-id":    cookies.get("ajs_anonymous_id", ""),
        "x-activity-session-id":     cookies.get("activitySessionId", ""),
        "sec-fetch-dest":            "empty",
        "sec-fetch-mode":            "cors",
        "sec-fetch-site":            "same-origin",
        "priority":                  "u=1, i",
    })

    url = (
        f"https://claude.ai/edge-api/bootstrap/{org_id}/app_start"
        "?statsig_hashing_algorithm=djb2&growthbook_format=sdk"
        "&cache_bust=1&include_system_prompts=false"
    )

    try:
        resp = session.get(url, timeout=timeout)
    except requests.RequestException as e:
        return {"error": str(e)}

    if resp.status_code != 200:
        return {"error": f"HTTP {resp.status_code}", "body": resp.text[:200]}

    try:
        data = resp.json()
    except Exception:
        return {"error": "invalid JSON", "body": resp.text[:200]}

    # --- Extract relevant fields ---
    account     = data.get("account", {})
    memberships = account.get("memberships", [])
    membership  = memberships[0] if memberships else {}
    org         = membership.get("organization", {})

    rate_upsell  = org.get("rate_limit_upsell", "")
    seat_tier    = membership.get("seat_tier") or org.get("plan_tier")
    billing_type = org.get("billing_type")

    if seat_tier:
        plan = seat_tier
    elif billing_type:
        plan = billing_type
    elif rate_upsell == "upgrade_to_pro":
        plan = "FREE"
    elif rate_upsell == "" or rate_upsell is None:
        plan = "PRO"
    else:
        plan = rate_upsell

    features = [
        f["feature"]
        for f in data.get("current_user_access", {}).get("features", [])
    ]

    return {
        "email":       account.get("email_address", "—"),
        "name":        account.get("full_name") or account.get("display_name") or "—",
        "uuid":        account.get("uuid", "—"),
        "plan":        plan,
        "rate_upsell": rate_upsell or "—",
        "org_name":    org.get("name", "—"),
        "org_id":      org_id,
        "features":    features[:10],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Claude multi-cookie checker",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("cookie_file", nargs="?", default="claude.txt")
    parser.add_argument("--output", "-o", default="", help="Output JSON file (default: <input>_results.json)")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between requests (seconds)")
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    cookie_file = Path(args.cookie_file)
    if not cookie_file.is_file():
        print(f"[ERROR] File not found: {cookie_file}", file=sys.stderr)
        return 2

    output_path = Path(args.output) if args.output else cookie_file.parent / (cookie_file.stem + "_results.json")

    text   = cookie_file.read_text(encoding="utf-8", errors="replace")
    blocks = split_cookie_blocks(text)
    print(f"[*] {len(blocks)} bloc(s) de cookies trouvé(s) dans {cookie_file}")

    results: dict[str, dict] = {}

    for i, block in enumerate(blocks, 1):
        key     = f"cookie_{i}"
        cookies = parse_block(block)
        n_cookies = len(cookies)
        org_id    = cookies.get("lastActiveOrg", "?")
        print(f"\n[{i}/{len(blocks)}] {key} — {n_cookies} cookies, org={org_id}")

        result = check_one(cookies, timeout=args.timeout)
        results[key] = result

        # Print summary
        if "error" in result:
            print(f"  ❌ Erreur : {result['error']}")
        else:
            plan_icon = "🆓" if result["plan"] == "FREE" else "✅"
            print(f"  {plan_icon} Email : {result['email']}")
            print(f"     Plan  : {result['plan']}")
            print(f"     Org   : {result['org_name']}")

        if i < len(blocks):
            time.sleep(args.delay)

    # Write JSON
    output_path.write_text(
        json.dumps(results, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\n[*] Résultats → {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
