import base64
from datetime import datetime
import json
import sys

import requests

TOKEN_URL = "https://www.crunchyroll.com/auth/v1/token"
PROFILE_URL = "https://www.crunchyroll.com/accounts/v1/me/profile"
MULTIPROFILE_URL = "https://www.crunchyroll.com/accounts/v1/me/multiprofile"
ACCOUNT_URL = "https://www.crunchyroll.com/accounts/v1/me"
SUBSCRIPTION_URL = "https://www.crunchyroll.com/subs/v4/accounts/{account_id}/subscriptions"
CLIENT_AUTH = "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6"
HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr,fr-FR;q=0.9,en;q=0.8",
    "Origin": "https://www.crunchyroll.com",
    "Referer": "https://www.crunchyroll.com/fr/account/membership",
    "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Microsoft Edge";v="152"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}


def parse_cookies(text):
    jar = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7 and parts[5]:
            jar[parts[5]] = parts[6]
    return jar


def json_or_empty(response):
    try:
        value = response.json()
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def decode_jwt(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))
    except (IndexError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def format_date(value):
    if not value or value == "N/A":
        return "N/A"
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d/%m/%Y")
    except ValueError:
        return text[:10] if len(text) >= 10 else text


def run(cookie_text):
    cookies = parse_cookies(cookie_text)
    cookie_string = "; ".join(f"{name}={value}" for name, value in cookies.items())
    token_headers = {
        **HEADERS_BASE,
        "Authorization": CLIENT_AUTH,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie_string,
        "etp-anonymous-id": cookies.get("ajs_anonymous_id", ""),
    }
    token_body = {
        "grant_type": "etp_rt_cookie",
        "scope": "offline_access",
        "device_id": cookies.get("device_id", ""),
        "device_name": "Microsoft Edge on Windows",
        "device_type": "com.crunchyroll.windows.edge",
    }

    try:
        token_response = requests.post(TOKEN_URL, headers=token_headers, data=token_body, timeout=15)
        token_grant = "etp_rt_cookie"
        if token_response.status_code != 200:
            token_grant = "refresh_token"
            token_body["grant_type"] = token_grant
            token_body["refresh_token"] = cookies.get("etp_rt", "")
            token_response = requests.post(TOKEN_URL, headers=token_headers, data=token_body, timeout=15)
        token_data = json_or_empty(token_response)
        if token_response.status_code != 200 or not token_data.get("access_token"):
            return {"isValid": False, "message": "Cookie Crunchyroll invalide ou expiré", "accountInfo": {"cookie_count": len(cookies), "token_status": token_response.status_code, "token_grant": token_grant, "token_error": token_response.text[:300]}}

        access_token = token_data["access_token"]
        token_type = token_data.get("token_type", "Bearer")
        jwt = decode_jwt(access_token)
        account_id = jwt.get("etp_user_id") or jwt.get("profile_id") or token_data.get("account_id", "N/A")
        benefits = jwt.get("benefits", []) if isinstance(jwt.get("benefits", []), list) else []
        jwt_status = jwt.get("status", "N/A")
        auth_headers = {**HEADERS_BASE, "Authorization": f"{token_type} {access_token}", "Cookie": cookie_string}

        account_response = requests.get(ACCOUNT_URL, headers=auth_headers, timeout=15)
        profile_response = requests.get(PROFILE_URL, headers=auth_headers, timeout=15)
        multiprofile_response = requests.get(MULTIPROFILE_URL, headers=auth_headers, timeout=15)
        account = json_or_empty(account_response) if account_response.status_code == 200 else {}
        profile = json_or_empty(profile_response) if profile_response.status_code == 200 else {}
        multiprofile = json_or_empty(multiprofile_response) if multiprofile_response.status_code == 200 else {}
        profiles = multiprofile.get("profiles", [])
        profiles = profiles if isinstance(profiles, list) else []
        profile_names = [item.get("profile_name") for item in profiles if isinstance(item, dict) and item.get("profile_name")]
        info = {
            "username": profile.get("profile_name") or profile.get("username", "N/A"),
            "email": account.get("email", "N/A"),
            "account_id": account_id,
            "country": jwt.get("country", "N/A"),
            "member_since": format_date(account.get("created", "N/A")),
            "account_status": account_response.status_code,
            "profile_status": profile_response.status_code,
            "multiprofile_status": multiprofile_response.status_code,
            "profile_count": len(profiles),
            "max_profiles": multiprofile.get("max_profiles", "N/A"),
            "profile_names": profile_names,
            "jwt_status": jwt_status,
            "token_grant": token_grant,
        }

        plan, tier, next_renewal = "Free Member", "N/A", "N/A"
        active, premium = ("true" if jwt_status != "N/A" else "N/A"), "false"
        subscription_response = requests.get(SUBSCRIPTION_URL.format(account_id=account_id), headers=auth_headers, timeout=15)
        subscription = json_or_empty(subscription_response)
        if subscription_response.status_code == 200:
            items = subscription.get("items", subscription.get("subscriptions", []))
            item = items[0] if isinstance(items, list) and items else {}
            sub_plan = item.get("plan", item.get("subscription_plan", {}))
            sub_plan = sub_plan if isinstance(sub_plan, dict) else {}
            plan_name = sub_plan.get("name", {})
            plan_name = plan_name if isinstance(plan_name, dict) else {}
            tier_data = sub_plan.get("tier", item.get("tier", {}))
            tier_data = tier_data if isinstance(tier_data, dict) else {"text": tier_data}
            plan = plan_name.get("text") or plan_name.get("value") or sub_plan.get("name") or item.get("plan_name") or item.get("type", "Free Member")
            tier = tier_data.get("text") or tier_data.get("value") or "N/A"
            next_renewal = format_date(item.get("nextRenewalDate") or item.get("next_renewal_date") or item.get("end_date", "N/A"))
            active = str(item.get("current", item.get("active", item.get("is_active", "N/A"))))
            premium = "true" if items and (active.lower() == "true" or item.get("status") == "active" or len(items) > 0) else "false"
        elif benefits:
            plan, premium = ", ".join(map(str, benefits)), "true"
        info.update({"plan": plan, "tier": tier, "premium": premium, "active": active, "next_renewal": next_renewal, "subscription_status": subscription_response.status_code})
        payment = subscription.get("currentPaymentMethod", {})
        invoice = subscription.get("latestInvoice", {})
        payment = payment if isinstance(payment, dict) else {}
        invoice = invoice if isinstance(invoice, dict) else {}
        amount = invoice.get("amount", {}) if isinstance(invoice.get("amount", {}), dict) else {}
        invoice_plans = invoice.get("plans", []) if isinstance(invoice.get("plans", []), list) else []
        info.update({
            "plan": plan,
            "tier": tier,
            "premium": premium,
            "active": active,
            "next_renewal": next_renewal,
            "subscription_status": subscription_response.status_code,
            "payment_method": payment.get("paymentMethodType", "N/A"),
            "payment_name": payment.get("name", "N/A"),
            "payment_status": payment.get("status", "N/A"),
            "payment_country": payment.get("countryCode", "N/A"),
            "latest_invoice_id": invoice.get("id", "N/A"),
            "latest_invoice_status": invoice.get("status", "N/A"),
            "latest_invoice_amount": amount.get("amount", "N/A"),
            "latest_invoice_currency": amount.get("currencyCode", "N/A"),
            "latest_invoice_text": amount.get("text", "N/A"),
            "latest_invoice_created": format_date(invoice.get("created", "N/A")),
            "latest_invoice_plans": [
                {
                    "name": item.get("name", {}).get("text", item.get("name", "N/A")) if isinstance(item, dict) else "N/A",
                    "sku": item.get("sku", "N/A") if isinstance(item, dict) else "N/A",
                    "start_date": format_date(item.get("startDate", "N/A")) if isinstance(item, dict) else "N/A",
                    "price": item.get("price", {}).get("text", "N/A") if isinstance(item, dict) and isinstance(item.get("price", {}), dict) else "N/A",
                }
                for item in invoice_plans
            ],
        })
        valid = account_response.status_code == 200 and profile_response.status_code == 200
        return {"isValid": valid, "message": "Cookie Crunchyroll valide" if valid else "Token valide mais compte inaccessible", "accountInfo": info}
    except requests.RequestException as error:
        return {"isValid": False, "message": f"Erreur API Crunchyroll: {error}", "accountInfo": {"cookie_count": len(cookies)}}


if __name__ == "__main__":
    try:
        print(json.dumps(run(sys.stdin.read()), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"isValid": False, "message": f"Erreur runner Python: {error}", "accountInfo": {}}))
        sys.exit(1)
