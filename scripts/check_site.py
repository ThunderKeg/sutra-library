#!/usr/bin/env python3
"""Static integrity checks for the generated GitHub Pages PWA."""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SOURCE_SHA256 = "72fbbaeef60b227d705a1e145dbf020935012d51a84f87bb7b8c7356972ab1d4"
EXPECTED_FACSIMILE_PAGES = [
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    52, 53, 54, 55, 56, 57,
    114, 115, 116, 117, 118, 119,
    176, 177, 178, 179, 180, 181,
    243, 244, 245, 246, 247,
    297, 298, 299, 300, 301, 302, 303,
    368, 369, 370, 371, 372, 373,
    440, 441, 442, 443, 444, 445,
    500, 501, 502, 503, 504, 505,
    569, 570, 571, 572, 573,
    618, 619, 620, 621, 622, 623, 624,
]


class RubyBaseTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rt_depth = 0
        self.text: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "rt":
            self.rt_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "rt":
            self.rt_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.rt_depth:
            self.text.append(data)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def html_base_text(markup: str) -> str:
    parser = RubyBaseTextParser()
    parser.feed(markup)
    return "".join(parser.text)


def main() -> int:
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    require(manifest["display"] == "standalone", "manifest must use standalone display")
    require(manifest["start_url"].startswith("./"), "manifest start_url must be GitHub Pages relative")
    for icon in manifest["icons"]:
        require((ROOT / icon["src"].removeprefix("./")).exists(), f"missing icon {icon['src']}")

    volume_index = json.loads((ROOT / "data/huayan/volume-01-index.json").read_text(encoding="utf-8"))
    require(volume_index["sourcePdfSha256"] == EXPECTED_SOURCE_SHA256, "source PDF digest changed")
    require(volume_index["pdfPageCount"] == 624, "source PDF page count changed")
    require(len(volume_index["sections"]) == 13, "volume 1 must expose front matter plus 12 reading sections")
    require(volume_index["sections"][0]["id"] == "front-matter", "front matter must be the first section")

    page_count = 0
    char_count = 0
    ruby_count = 0
    restored_count = 0
    pdf_pages: list[int] = []
    printed_pages: list[int] = []
    page_keys: list[str] = []
    facsimile_pages: list[int] = []
    generated_pages: dict[int, dict[str, object]] = {}
    for section in volume_index["sections"]:
        content_path = ROOT / section["content"]
        require(content_path.exists(), f"missing content {section['content']}")
        content = json.loads(content_path.read_text(encoding="utf-8"))
        require(content["id"] == section["id"], f"section id mismatch for {content_path}")
        require(content["pageCount"] == len(content["pages"]), f"page count mismatch for {content_path}")
        require(content["charCount"] == sum(page["charCount"] for page in content["pages"]), f"section char count mismatch for {content_path}")
        require(content["rubyCount"] == sum(page["rubyCount"] for page in content["pages"]), f"section ruby count mismatch for {content_path}")
        for page in content["pages"]:
            pdf_page = page["pdfPage"]
            require(hashlib.sha256(page["text"].encode("utf-8")).hexdigest() == page["textSha256"], f"text hash mismatch at PDF page {pdf_page}")
            require(page["charCount"] == len(page["text"]), f"character count mismatch at PDF page {pdf_page}")
            require(page["pageLabel"] and page["folioLabel"], f"page labels missing at PDF page {pdf_page}")
            if page.get("facsimile"):
                require((ROOT / page["facsimile"]).exists(), f"missing facsimile at PDF page {pdf_page}")
                require(page["charCount"] == page["rubyCount"] == 0, f"facsimile page claims HTML text at PDF page {pdf_page}")
                facsimile_pages.append(pdf_page)
            else:
                require(page["rubyCount"] > 0, f"missing source ruby annotations at PDF page {pdf_page}")
                require(page["html"].count("<ruby>") == page["rubyCount"], f"ruby count mismatch at PDF page {pdf_page}")
                require(html_base_text(page["html"]) == page["text"], f"HTML base text mismatch at PDF page {pdf_page}")
            if page["printedPage"] is None:
                require(pdf_page <= 9 and page["pageKey"] == f"pdf-{pdf_page:03d}", f"invalid front-matter identity at PDF page {pdf_page}")
            else:
                require(page["printedPage"] == pdf_page - 9, f"printed page mismatch at PDF page {pdf_page}")
                require(page["pageKey"] == f"printed-{page['printedPage']}", f"invalid printed page key at PDF page {pdf_page}")
                printed_pages.append(page["printedPage"])
            pdf_pages.append(pdf_page)
            page_keys.append(page["pageKey"])
            generated_pages[pdf_page] = page
            page_count += 1
            char_count += page["charCount"]
            ruby_count += page["rubyCount"]
            restored_count += page["restoredBodyCharCount"]

    require(pdf_pages == list(range(1, 625)), "PDF pages 1 through 624 are not represented exactly once in order")
    require(printed_pages == list(range(1, 616)), "printed pages 1 through 615 are not represented exactly once in order")
    require(len(page_keys) == len(set(page_keys)), "duplicate page keys")
    require(facsimile_pages == EXPECTED_FACSIMILE_PAGES, "facsimile page policy changed")
    require(volume_index["facsimilePdfPages"] == EXPECTED_FACSIMILE_PAGES, "index facsimile list mismatch")
    require(volume_index["offlineAssets"] == [generated_pages[page]["facsimile"] for page in EXPECTED_FACSIMILE_PAGES], "offline facsimile assets mismatch")
    require(page_count == volume_index["pageCount"] == 624, "index page count mismatch")
    require(char_count == volume_index["charCount"] == 76918, "index character count mismatch")
    require(ruby_count == volume_index["rubyCount"] == 67442, "source pinyin count mismatch")
    require(restored_count == volume_index["restoredBodyCharCount"] == 41, "restored body glyph count mismatch")
    require(volume_index["textPageCount"] == 555 and volume_index["facsimilePageCount"] == 69, "text/facsimile split mismatch")
    require("琉璃為榦" in generated_pages[12]["text"] and "以為枝條" in generated_pages[12]["text"], "known fallback-font ordering regression at PDF page 12")
    require("鳩槃荼荼" not in "".join(str(page["text"]) for page in generated_pages.values()), "duplicated restored body glyph")
    require('<span class="han">佛</span><rt>fó</rt>' in generated_pages[11]["html"], "source pronunciation 佛 fó was not preserved")

    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    reader_html = (ROOT / "reader.html").read_text(encoding="utf-8")
    app_script = (ROOT / "assets/app.js").read_text(encoding="utf-8")
    reader_script = (ROOT / "assets/reader.js").read_text(encoding="utf-8")
    service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    require("manifest.webmanifest" in index_html and "manifest.webmanifest" in reader_html, "manifest link missing")
    require("writing-mode: vertical-rl" in (ROOT / "assets/styles.css").read_text(encoding="utf-8"), "vertical layout missing")
    require(reader_html.index('id="nextSection"') < reader_html.index('id="previousSection"'), "next section control must be on the left")
    require("sectionContinuation" in reader_script and "sectionReturn" in reader_script, "two-way section edge indicators missing")
    require("hasPreviousSection" in reader_script and "goToPreviousSection" in reader_script, "pull-to-previous interaction missing")
    require('loadSection(activeSectionIndex - 1, { edge: "end" })' in reader_script, "pull-to-previous must land on the previous section end")
    require('"touchmove", handleTouchMove, { passive: false }' in reader_script, "touch edge pull must be cancelable at the boundary")
    require('"wheel", handleWheel, { passive: false }' in reader_script, "trackpad edge pull interaction missing")
    require("pageOffsetRatio" in reader_script and "resumeRequested" in reader_script, "exact page resume missing")
    require("pageElementFor" in reader_script and "page.pageKey" in reader_script and "sourcePageLabel" in reader_script, "stable page-key resume missing")
    require('resume: "1"' in app_script and 'params.set("page", String(progress.sourcePage))' in app_script, "resume card must preserve the saved source page")
    visible_copy = index_html + reader_html + app_script + reader_script + (ROOT / "data/library.json").read_text(encoding="utf-8")
    for unnatural_copy in ("拼音依原 PDF 字形還原", "原書第", "PDF 前置第", "原始 PDF 來源", "查看原始資料"):
        require(unnatural_copy not in visible_copy, f"unnatural reader copy remains: {unnatural_copy}")
    require("文本來源 · 圓道禪院漢語拼音版" in visible_copy, "reader source attribution missing")
    require("volume-01-index.json" in service_worker, "service worker does not cache book index")
    require('updateViaCache: "none"' in app_script and "registration.update()" in app_script, "foreground service-worker update checks missing")
    require('"visibilitychange"' in app_script and '"focus"' in app_script and '"online"' in app_script, "update checks must run when the PWA returns online or foreground")
    require("clients.matchAll" in service_worker and "client.navigate(client.url)" in service_worker, "active PWA clients are not refreshed after an update")
    require('postMessage({ type: "CACHE_BOOK" })' in app_script and 'event.data?.type === "CACHE_BOOK"' in service_worker, "background book cache warming missing")
    require("bookCachePromise" in service_worker and "missingAssets" in service_worker, "background book cache warming must be deduplicated")
    require("sutra-library-v8-20260722-auto-update" in service_worker, "service worker cache version was not bumped")

    print(
        f"Site checks passed: {len(volume_index['sections'])} sections, {page_count} PDF pages, "
        f"{char_count} HTML characters, {ruby_count} source pinyin glyphs, {len(facsimile_pages)} facsimiles"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, KeyError, json.JSONDecodeError) as error:
        print(f"CHECK FAILED: {error}", file=sys.stderr)
        sys.exit(1)
