import json
import time
import urllib.error
import urllib.request
from pathlib import Path

proxy_path = Path("rendproxy.txt")
cookie_path = Path("dddd.txt")
log_path = Path("render_proxy_results.log")
url = "https://netcookies-paramount-checker.onrender.com/validate"

cookies = []
for line in cookie_path.read_text(encoding="utf-8", errors="ignore").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = [p.strip() for p in line.split("\t")]
    if len(parts) < 7:
        continue

    domain, flag, pth, secure, expiry, name, value = parts[:7]
    cookies.append({
        "domain": domain,
        "flag": flag,
        "path": pth,
        "secure": secure.upper() == "TRUE",
        "expiry": expiry,
        "name": name,
        "value": value,
    })

def display_proxy(proxy):
    if "@" in proxy:
        return "http://***:***@" + proxy.rsplit("@", 1)[1]
    return "http://" + proxy


def test_proxy(proxy):
    proxy = proxy.strip()
    if not proxy or proxy.startswith("#"):
        return None

    proxy_url = proxy if "://" in proxy else f"http://{proxy}"
    started_at = time.monotonic()
    payload = {"proxy_url": proxy_url, "cookies": cookies}
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = response.read().decode("utf-8", errors="replace")
            return {
                "status": "OK",
                "http_status": response.status,
                "duration": time.monotonic() - started_at,
                "body": body,
            }
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {
            "status": "HTTP_ERROR",
            "http_status": error.code,
            "duration": time.monotonic() - started_at,
            "body": body,
        }
    except urllib.error.URLError as error:
        return {
            "status": "NETWORK_ERROR",
            "duration": time.monotonic() - started_at,
            "body": str(error.reason),
        }
    except TimeoutError as error:
        return {
            "status": "TIMEOUT",
            "duration": time.monotonic() - started_at,
            "body": str(error),
        }
    except Exception as error:
        return {
            "status": "ERROR",
            "duration": time.monotonic() - started_at,
            "body": f"{type(error).__name__}: {error}",
        }


proxies = proxy_path.read_text(encoding="utf-8", errors="ignore").splitlines()
with log_path.open("w", encoding="utf-8") as log:
    log.write(f"Render proxy test - {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    log.write(f"Endpoint: {url}\nCookies loaded: {len(cookies)}\n\n")

    tested = 0
    for proxy in proxies:
        result = test_proxy(proxy)
        if result is None:
            continue

        tested += 1
        safe_proxy = display_proxy(proxy.strip())
        duration = result["duration"]
        line = (
            f"[{tested:02d}] {result['status']} "
            f"HTTP={result.get('http_status', '-')} "
            f"TIME={duration:.2f}s PROXY={safe_proxy}"
        )
        print(line)
        print(f"      {result['body']}")
        log.write(line + "\n")
        log.write(f"      {result['body']}\n")

    log.write(f"\nTotal tested: {tested}\n")
print(f"\nLog saved to: {log_path.resolve()}")