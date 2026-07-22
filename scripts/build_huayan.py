#!/usr/bin/env python3
"""Build Huayan volume 1 reader data from the downloadable source PDF.

The PDF contains two visually aligned text layers: a large Traditional Chinese
layer and a smaller custom-font pinyin layer. The pinyin font's Unicode map does
not represent the visible Latin glyphs, so this builder extracts only the
Traditional Chinese layer and regenerates tone-marked pinyin with pypinyin.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image
from pypinyin import Style, pinyin


NON_BODY_FONTS = {
    "DFPHeiW7-HPinIn1WL-BFW",  # custom-mapped source pinyin layer
    "YenRound-Ultra",          # Latin pinyin on mantra charts
    "IDYuanBold",              # page folios and display titles
    "DFWeiBei-W7-WIN-BF",      # running headers
    "siddam",                  # Siddham glyph chart without reliable Unicode
}
CHINESE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    short_title: str
    first_pdf_page: int
    last_pdf_page: int


SECTIONS = (
    Section("kaijing-ji", "開經偈", "開經偈", 10, 10),
    Section("juan-01", "卷一　世主妙嚴品第一之一", "卷一", 11, 57),
    Section("juan-02", "卷二　世主妙嚴品第一之二", "卷二", 58, 119),
    Section("juan-03", "卷三　世主妙嚴品第一之三", "卷三", 120, 181),
    Section("juan-04", "卷四　世主妙嚴品第一之四", "卷四", 182, 247),
    Section("juan-05", "卷五　世主妙嚴品第一之五", "卷五", 248, 303),
    Section("juan-06", "卷六　如來現相品第二", "卷六", 304, 373),
    Section("juan-07-puxian", "卷七　普賢三昧品第三", "卷七 · 普賢三昧品", 374, 389),
    Section("juan-07-shijie", "卷七　世界成就品第四", "卷七 · 世界成就品", 390, 445),
    Section("juan-08", "卷八　華藏世界品第五之一", "卷八", 446, 505),
    Section("juan-09", "卷九　華藏世界品第五之二", "卷九", 506, 573),
    Section("juan-10", "卷十　華藏世界品第五之三", "卷十", 574, 624),
)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf",
        type=Path,
        default=repo_root / "sources" / "pdf" / "2020-HuaYanJing-pinyin-01.pdf",
        help="Path to the first-volume PDF",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=repo_root,
        help="Static-site root receiving data/huayan files",
    )
    return parser.parse_args()


def extract_body_text(page: fitz.Page) -> str:
    fragments: list[tuple[float, float, str]] = []
    page_dict = page.get_text("dict")
    for block in page_dict.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                font = span.get("font")
                size = float(span.get("size", 0))
                is_scripture_body = size >= 17 and font not in NON_BODY_FONTS
                if is_scripture_body:
                    x0, y0, _, _ = span.get("bbox", (0, 0, 0, 0))
                    fragments.append((float(x0), float(y0), span.get("text", "")))

    # Every readable source page is set vertically, top-to-bottom and right-to-left.
    fragments.sort(key=lambda item: (-round(item[0], 1), item[1]))
    text = "".join(fragment for _, _, fragment in fragments)
    normalized = (
        text.replace("\u3000", "")
        .replace(" ", "")
        .replace("\r", "")
        .replace("\n", "")
        .strip()
    )
    # Drop control and private-use placeholders emitted by decorative PDF fonts.
    normalized = "".join(
        character
        for character in normalized
        if ord(character) >= 32 and not 0xE000 <= ord(character) <= 0xF8FF
    )
    return normalized if CHINESE_RE.search(normalized) else ""


def annotate(text: str) -> str:
    pronunciations = pinyin(
        text,
        style=Style.TONE,
        heteronym=False,
        neutral_tone_with_five=False,
        errors=lambda value: list(value),
    )
    if len(pronunciations) != len(text):
        raise RuntimeError(f"Pinyin alignment mismatch: {len(text)} chars vs {len(pronunciations)} tokens")

    output: list[str] = []
    for character, candidates in zip(text, pronunciations):
        escaped_character = html.escape(character, quote=False)
        pronunciation = candidates[0] if candidates else ""
        if CHINESE_RE.fullmatch(character) and pronunciation and pronunciation != character:
            output.append(
                f'<ruby><span class="han">{escaped_character}</span><rt>{html.escape(pronunciation, quote=False)}</rt></ruby>'
            )
        elif character in "，。！？；：、（）《》〈〉「」『』〔〕—…．":
            output.append(f'<span class="punctuation">{escaped_character}</span>')
        else:
            output.append(escaped_character)
    return "".join(output)


def page_label(first: int, last: int) -> str:
    first_printed = first - 9
    last_printed = last - 9
    return f"第 {first_printed} 頁" if first_printed == last_printed else f"第 {first_printed}–{last_printed} 頁"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def render_facsimile(page: fitz.Page, output_path: Path) -> None:
    """Preserve charts, Siddham glyphs, and small-print appendix pages as images."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csGRAY, alpha=False)
    with Image.open(io.BytesIO(pixmap.tobytes("png"))) as image:
        image.save(output_path, format="WEBP", lossless=True, method=6)


def main() -> int:
    args = parse_args()
    pdf_path = args.pdf.resolve()
    output_root = args.output_root.resolve()
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    document = fitz.open(pdf_path)
    if document.page_count != 624:
        raise RuntimeError(f"Expected 624 PDF pages, found {document.page_count}")

    content_dir = output_root / "data" / "huayan" / "volume-01"
    facsimile_dir = output_root / "assets" / "facsimiles" / "huayan-01"
    index_sections: list[dict[str, object]] = []
    total_characters = 0
    total_pages = 0
    facsimile_pdf_pages: list[int] = []
    offline_assets: list[str] = []

    for section in SECTIONS:
        pages: list[dict[str, object]] = []
        section_characters = 0
        for pdf_page_number in range(section.first_pdf_page, section.last_pdf_page + 1):
            text = extract_body_text(document[pdf_page_number - 1])
            if not text:
                printed_page = pdf_page_number - 9
                facsimile_name = f"pdf-page-{pdf_page_number:03d}.webp"
                facsimile_path = facsimile_dir / facsimile_name
                render_facsimile(document[pdf_page_number - 1], facsimile_path)
                relative_facsimile = f"assets/facsimiles/huayan-01/{facsimile_name}"
                pages.append(
                    {
                        "pdfPage": pdf_page_number,
                        "printedPage": printed_page,
                        "charCount": 0,
                        "textSha256": hashlib.sha256(b"").hexdigest(),
                        "text": "",
                        "html": "",
                        "facsimile": relative_facsimile,
                    }
                )
                facsimile_pdf_pages.append(pdf_page_number)
                offline_assets.append(relative_facsimile)
                continue
            printed_page = pdf_page_number - 9
            text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            pages.append(
                {
                    "pdfPage": pdf_page_number,
                    "printedPage": printed_page,
                    "charCount": len(text),
                    "textSha256": text_hash,
                    "text": text,
                    "html": annotate(text),
                }
            )
            section_characters += len(text)

        if not pages:
            raise RuntimeError(f"No readable body text extracted for {section.id}")

        filename = f"{section.id}.json"
        relative_content = f"data/huayan/volume-01/{filename}"
        payload = {
            "id": section.id,
            "title": section.title,
            "shortTitle": section.short_title,
            "sourcePageLabel": page_label(section.first_pdf_page, section.last_pdf_page),
            "pageCount": len(pages),
            "charCount": section_characters,
            "pages": pages,
        }
        write_json(content_dir / filename, payload)
        index_sections.append(
            {
                "id": section.id,
                "title": section.title,
                "shortTitle": section.short_title,
                "sourcePageLabel": page_label(section.first_pdf_page, section.last_pdf_page),
                "content": relative_content,
                "pageCount": len(pages),
                "charCount": section_characters,
            }
        )
        total_pages += len(pages)
        total_characters += section_characters

    index_payload = {
        "id": "huayan-01",
        "bookId": "huayan",
        "bookTitle": "大方廣佛華嚴經",
        "volume": "01",
        "volumeLabel": "第一冊",
        "language": "zh-Hant",
        "readingMode": "vertical-rl",
        "annotation": "tone-marked pinyin generated from the extracted Traditional Chinese text",
        "translator": "唐于闐國三藏沙門實叉難陀譯",
        "sourceUrl": "https://yuandao-world.org/2020/04/14/%E5%A4%A7%E6%96%B9%E5%BB%A3%E4%BD%9B%E8%8F%AF%E5%9A%B4%E7%B6%93-%E6%BC%A2%E8%AA%9E%E6%8B%BC%E9%9F%B3%E7%89%88%E9%9B%BB%E5%AD%90%E6%AA%94%E4%B8%8B%E8%BC%89/",
        "sourcePdf": pdf_path.name,
        "sourcePdfSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        "pdfPageCount": document.page_count,
        "pageCount": total_pages,
        "textPageCount": total_pages - len(facsimile_pdf_pages),
        "facsimilePageCount": len(facsimile_pdf_pages),
        "charCount": total_characters,
        "facsimilePdfPages": facsimile_pdf_pages,
        "offlineAssets": offline_assets,
        "sections": index_sections,
    }
    write_json(output_root / "data" / "huayan" / "volume-01-index.json", index_payload)

    print(f"Built {len(index_sections)} sections, {total_pages} pages, {total_characters} characters")
    print(f"Facsimile fallback pages: {facsimile_pdf_pages}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
