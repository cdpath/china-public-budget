"""Download the MOF expenditure pages listed in README.md into data/raw/."""

import pathlib
import re
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

# The MOF WAF rejects requests that don't look like a browser.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://yss.mof.gov.cn/",
}


def sources():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    for year, url in re.findall(r"\[(\d{4})年[^\]]*\]\((https?://[^)]+)\)", text):
        yield int(year), url


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    for year, url in sources():
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
        (RAW / f"{year}.htm").write_bytes(body)
        print(year, len(body))
        time.sleep(1)


if __name__ == "__main__":
    main()
