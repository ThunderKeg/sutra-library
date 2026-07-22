#!/usr/bin/env python3
"""Static integrity checks for the generated GitHub Pages PWA."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    require(manifest["display"] == "standalone", "manifest must use standalone display")
    require(manifest["start_url"].startswith("./"), "manifest start_url must be GitHub Pages relative")
    for icon in manifest["icons"]:
        require((ROOT / icon["src"].removeprefix("./")).exists(), f"missing icon {icon['src']}")

    volume_index = json.loads((ROOT / "data/huayan/volume-01-index.json").read_text(encoding="utf-8"))
    require(len(volume_index["sections"]) == 12, "volume 1 must expose 12 TOC sections")

    page_count = 0
    char_count = 0
    printed_pages: list[int] = []
    for section in volume_index["sections"]:
        content_path = ROOT / section["content"]
        require(content_path.exists(), f"missing content {section['content']}")
        content = json.loads(content_path.read_text(encoding="utf-8"))
        require(content["id"] == section["id"], f"section id mismatch for {content_path}")
        require(content["pageCount"] == len(content["pages"]), f"page count mismatch for {content_path}")
        for page in content["pages"]:
            require(hashlib.sha256(page["text"].encode("utf-8")).hexdigest() == page["textSha256"], f"text hash mismatch at PDF page {page['pdfPage']}")
            require(page["charCount"] == len(page["text"]), f"character count mismatch at PDF page {page['pdfPage']}")
            if page.get("facsimile"):
                require((ROOT / page["facsimile"]).exists(), f"missing facsimile at PDF page {page['pdfPage']}")
                require(page["charCount"] == 0, f"facsimile page must not claim extracted text at PDF page {page['pdfPage']}")
            else:
                require("<ruby>" in page["html"], f"missing ruby annotations at PDF page {page['pdfPage']}")
            printed_pages.append(page["printedPage"])
            page_count += 1
            char_count += page["charCount"]

    require(page_count == volume_index["pageCount"], "index page count mismatch")
    require(char_count == volume_index["charCount"], "index character count mismatch")
    require(volume_index["textPageCount"] + volume_index["facsimilePageCount"] == page_count, "text/facsimile split mismatch")
    require(page_count == 615, "the first volume must preserve source pages 1 through 615")
    require(printed_pages == sorted(printed_pages), "printed pages are not ordered")
    require(len(set(printed_pages)) == len(printed_pages), "duplicate printed pages")

    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    reader_html = (ROOT / "reader.html").read_text(encoding="utf-8")
    service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    require("manifest.webmanifest" in index_html and "manifest.webmanifest" in reader_html, "manifest link missing")
    require("writing-mode: vertical-rl" in (ROOT / "assets/styles.css").read_text(encoding="utf-8"), "vertical layout missing")
    require("volume-01-index.json" in service_worker, "service worker does not cache book index")
    require(re.search(r'CACHE_VERSION\s*=\s*"[^"]+"', service_worker) is not None, "service worker cache version missing")

    print(f"Site checks passed: {len(volume_index['sections'])} sections, {page_count} pages, {char_count} characters")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, KeyError, json.JSONDecodeError) as error:
        print(f"CHECK FAILED: {error}", file=sys.stderr)
        sys.exit(1)
