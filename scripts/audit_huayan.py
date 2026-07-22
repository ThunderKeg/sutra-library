#!/usr/bin/env python3
"""Independent first-volume audit using pdfplumber instead of the generator API."""

from __future__ import annotations

from collections import defaultdict
import argparse
import glob
import hashlib
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image
import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = "72fbbaeef60b227d705a1e145dbf020935012d51a84f87bb7b8c7356972ab1d4"
PINYIN_FONT = "DFPHeiW7-HPinIn1WL-BFW"
NON_BODY_FONTS = (PINYIN_FONT, "YenRound-Ultra", "IDYuanBold", "DFWeiBei-W7-WIN-BF", "siddam")
CHINESE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")

# pdfplumber exposes the source pinyin proxy where a visible large glyph has no
# Unicode mapping.  Most proxies equal the body glyph; 猴 is the homophone used
# for the visible character 睺.  The last four entries cover six pdfplumber-only
# end-of-column extraction gaps and are normalized below from rendered pages.
BODY_FROM_PINYIN_PROXY = {
    "滋": "滋", "荼": "荼", "猴": "睺", "類": "類", "璃": "璃", "輞": "輞",
    "伽": "伽", "王": "王", "花": "花", "地": "地",
}
PDFPLUMBER_SOURCE_CORRECTIONS = {
    38: (("摩睺羅伽伽", "摩睺羅伽"),),
    126: (("鳩槃王王", "鳩槃荼王"),),
    139: (
        ("燈幢摩羅伽伽王", "燈幢摩睺羅伽王"),
        ("眾妙莊嚴音摩羅伽王王", "眾妙莊嚴音摩睺羅伽王"),
    ),
    478: (("輪輞輞", "輪輞"),),
    566: (("琉華花", "琉璃華"),),
    576: (("玻地地", "玻璃地"),),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf",
        type=Path,
        default=ROOT / "sources" / "pdf" / "2020-HuaYanJing-pinyin-01.pdf",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def usable(text: str) -> bool:
    return bool(text.strip()) and all(not 0xE000 <= ord(character) <= 0xF8FF for character in text)


def order_vertical(glyphs: list[dict[str, object]]) -> str:
    columns: list[list[dict[str, object]]] = []
    centers: list[float] = []
    for glyph in sorted(glyphs, key=lambda item: -float(item["x"])):
        column_index = next(
            (index for index, center in enumerate(centers) if abs(float(glyph["x"]) - center) <= 4),
            None,
        )
        if column_index is None:
            columns.append([glyph])
            centers.append(float(glyph["x"]))
        else:
            columns[column_index].append(glyph)
            centers[column_index] = sum(float(item["x"]) for item in columns[column_index]) / len(columns[column_index])
    return "".join(
        str(glyph["character"])
        for _, column in sorted(zip(centers, columns), key=lambda item: -item[0])
        for glyph in sorted(column, key=lambda item: (float(item["y"]), -float(item["x"])))
    )


def independently_extract_page(page: pdfplumber.page.Page, pdf_page: int) -> tuple[str, int]:
    body: list[dict[str, object]] = []
    source_pinyin: list[dict[str, object]] = []
    for source_char in page.chars:
        text = str(source_char["text"])
        if not usable(text):
            continue
        font = str(source_char["fontname"])
        size = float(source_char["size"])
        if PINYIN_FONT in font:
            for character in text:
                if character.strip():
                    source_pinyin.append(
                        {"character": character, "x": float(source_char["x0"]), "y": float(source_char["top"])}
                    )
        elif size >= 17 and not any(excluded in font for excluded in NON_BODY_FONTS):
            for character in text:
                body.append(
                    {
                        "character": character,
                        "x": (float(source_char["x0"]) + float(source_char["x1"])) / 2,
                        "y": float(source_char["top"]),
                    }
                )

    used_pinyin: set[int] = set()
    for body_glyph in body:
        if not CHINESE_RE.fullmatch(str(body_glyph["character"])):
            continue
        candidates: list[tuple[float, int, dict[str, object]]] = []
        for index, pinyin_glyph in enumerate(source_pinyin):
            if index in used_pinyin:
                continue
            dx = abs(float(pinyin_glyph["x"]) - float(body_glyph["x"]))
            dy = abs(float(pinyin_glyph["y"]) - float(body_glyph["y"]))
            if dx < 14 and dy < 14:
                candidates.append((dx + dy, index, pinyin_glyph))
        if candidates:
            _, index, pinyin_glyph = min(candidates)
            used_pinyin.add(index)
            body_glyph["x"] = float(pinyin_glyph["x"]) - 10
            body_glyph["y"] = float(pinyin_glyph["y"])

    for index, pinyin_glyph in enumerate(source_pinyin):
        if index in used_pinyin:
            continue
        proxy = str(pinyin_glyph["character"])
        restored = BODY_FROM_PINYIN_PROXY.get(proxy)
        require(restored is not None, f"PDF page {pdf_page}: unknown unmatched pdfplumber pinyin proxy {proxy!r}")
        body.append(
            {
                "character": restored,
                "x": float(pinyin_glyph["x"]) - 10,
                "y": float(pinyin_glyph["y"]),
            }
        )

    text = order_vertical(body)
    for before, after in PDFPLUMBER_SOURCE_CORRECTIONS.get(pdf_page, ()):
        require(before in text, f"PDF page {pdf_page}: expected pdfplumber correction target {before!r} missing")
        text = text.replace(before, after)
    return text, len(source_pinyin)


def load_site_pages() -> dict[int, dict[str, object]]:
    pages: dict[int, dict[str, object]] = {}
    for filename in glob.glob(str(ROOT / "data" / "huayan" / "volume-01" / "*.json")):
        section = json.loads(Path(filename).read_text(encoding="utf-8"))
        for page in section["pages"]:
            pdf_page = int(page["pdfPage"])
            require(pdf_page not in pages, f"duplicate generated PDF page {pdf_page}")
            pages[pdf_page] = page
    return pages


def main() -> int:
    args = parse_args()
    pdf_path = args.pdf.resolve()
    require(pdf_path.exists(), f"source PDF missing: {pdf_path}")
    require(source_sha256(pdf_path) == SOURCE_SHA256, "source PDF digest changed")
    site_pages = load_site_pages()
    require(sorted(site_pages) == list(range(1, 625)), "generated data does not cover PDF pages 1 through 624")

    text_pages = 0
    facsimile_pages = 0
    independently_counted_pinyin = 0
    with pdfplumber.open(pdf_path) as source:
        require(len(source.pages) == 624, "source PDF page count changed")
        for pdf_page, source_page in enumerate(source.pages, start=1):
            generated = site_pages[pdf_page]
            facsimile = generated.get("facsimile")
            if facsimile:
                image_path = ROOT / str(facsimile)
                require(image_path.exists(), f"PDF page {pdf_page}: facsimile missing")
                with Image.open(image_path) as image:
                    expected_size = (math.ceil(float(source_page.width) * 2), math.ceil(float(source_page.height) * 2))
                    require(image.size == expected_size, f"PDF page {pdf_page}: facsimile dimensions differ from 2x source")
                    require(image.format == "WEBP", f"PDF page {pdf_page}: facsimile is not WebP")
                facsimile_pages += 1
                continue

            source_text, source_pinyin_count = independently_extract_page(source_page, pdf_page)
            generated_text = str(generated["text"])
            require(
                source_text == generated_text,
                f"PDF page {pdf_page}: independent source text differs at first index "
                f"{next((i for i, pair in enumerate(zip(source_text, generated_text)) if pair[0] != pair[1]), min(len(source_text), len(generated_text)))}",
            )
            require(int(generated["rubyCount"]) == source_pinyin_count, f"PDF page {pdf_page}: source pinyin glyph count differs")
            independently_counted_pinyin += source_pinyin_count
            text_pages += 1

    require(text_pages == 555 and facsimile_pages == 69, "unexpected HTML/facsimile page split")
    require(independently_counted_pinyin == 67442, "independent source pinyin total differs")
    print(
        "Independent Huayan audit passed: 624/624 PDF pages represented; "
        "555 HTML pages match pdfplumber text reconstruction; 67,442 source pinyin glyphs counted; "
        "69 complex pages preserve 2x source facsimiles"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, KeyError, json.JSONDecodeError) as error:
        print(f"AUDIT FAILED: {error}", file=sys.stderr)
        sys.exit(1)
