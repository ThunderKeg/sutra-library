#!/usr/bin/env python3
"""Build the source-faithful Huayan volume 1 reader from its PDF.

Ordinary scripture pages become vertical HTML.  Their Traditional Chinese text
is reconstructed character-by-character from PDF coordinates and their ruby
annotations are decoded from the source PDF's embedded custom pinyin font.
Front matter and pages whose typography cannot be represented faithfully as
HTML (Siddham charts, Huayan alphabet tables, and the colophon) are preserved as
lossless page facsimiles.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import html
import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import fitz
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from PIL import Image
from pypinyin import Style, pinyin


SOURCE_PDF_SHA256 = "72fbbaeef60b227d705a1e145dbf020935012d51a84f87bb7b8c7356972ab1d4"
PINYIN_FONT = "DFPHeiW7-HPinIn1WL-BFW"
PINYIN_OVERRIDES_PATH = Path(__file__).with_name("huayan_pinyin_overrides.json")
NON_BODY_FONTS = {
    PINYIN_FONT,
    "YenRound-Ultra",          # Latin pinyin on mantra charts
    "IDYuanBold",              # page folios and display titles
    "DFWeiBei-W7-WIN-BF",      # running headers
    "siddam",                  # Siddham glyph chart without reliable Unicode
}
CHINESE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
PUNCTUATION = "，。！？；：、（）《》〈〉「」『』〔〕—…．"

# A few valid source pinyin shapes are shared by proxy characters for which
# pypinyin has no common candidate intersection.  These readings were verified
# directly against the embedded glyph outlines.
MANUAL_PINYIN_BY_PROXY_GROUP = {
    frozenset("唯圍惟為維違"): "wéi",
    frozenset("常長"): "cháng",
    frozenset("盡覲近進"): "jìn",
    frozenset("條調"): "tiáo",
    frozenset("印垽蔭"): "yìn",
    frozenset("博薄"): "bó",
    frozenset("叉差"): "chā",
    frozenset("就救究"): "jiù",
    frozenset("攝舍"): "shè",
    frozenset("俾庇必畢臂蔽詖陛"): "bì",
    frozenset("夕戲細"): "xì",
    frozenset("勒樂"): "lè",
    frozenset("似四"): "sì",
    frozenset("陋露"): "lòu",
}

# These 41 visible body characters have no usable Unicode entry in the PDF's
# large-text layer.  Their aligned pinyin proxy glyphs identify the positions;
# the visible body glyphs were checked against source-page renderings.
MISSING_BODY_CHAR_BY_PINYIN_PROXY = {
    "滋": "滋",
    "荼": "荼",
    "猴": "睺",
    "類": "類",
    "璃": "璃",
    "輞": "輞",
}


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    short_title: str
    first_pdf_page: int
    last_pdf_page: int
    front_matter: bool = False


@dataclass
class BodyGlyph:
    character: str
    x_center: float
    y0: float
    x1: float
    pronunciation: str | None = None
    synthetic: bool = False


@dataclass(frozen=True)
class PinyinGlyph:
    proxy_character: str
    glyph_id: int
    x0: float
    y0: float


SECTIONS = (
    Section("front-matter", "第一冊前置資料", "前置資料", 1, 9, True),
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


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def glyph_outline_hash(glyph_set: object, glyph_name: str) -> str:
    pen = RecordingPen()
    glyph_set[glyph_name].draw(pen)
    return hashlib.sha256(repr(pen.value).encode("utf-8")).hexdigest()


def proxy_pinyin_candidates(character: str) -> set[str]:
    readings = pinyin(
        character,
        style=Style.TONE,
        heteronym=True,
        neutral_tone_with_five=False,
        errors=lambda value: list(value),
    )
    if not readings:
        return set()
    return {reading for reading in readings[0] if reading and reading != character}


def embedded_pinyin_font(document: fitz.Document) -> bytes:
    for page in document:
        for font in page.get_fonts(full=True):
            xref, _, _, base_name = font[:4]
            if PINYIN_FONT in base_name:
                return document.extract_font(xref)[-1]
    raise RuntimeError(f"Embedded source pinyin font {PINYIN_FONT!r} was not found")


def decode_source_pinyin(document: fitz.Document) -> dict[int, str]:
    """Map embedded glyph IDs to the Latin pinyin visibly drawn by the PDF."""
    glyph_proxy_characters: dict[int, set[str]] = defaultdict(set)
    for page in document:
        for trace in page.get_texttrace():
            if trace["font"] != PINYIN_FONT:
                continue
            for unicode_value, glyph_id, _origin, _bbox in trace["chars"]:
                character = chr(unicode_value)
                if character.strip():
                    glyph_proxy_characters[glyph_id].add(character)

    font = TTFont(io.BytesIO(embedded_pinyin_font(document)), lazy=True)
    glyph_set = font.getGlyphSet()
    glyph_order = font.getGlyphOrder()
    outline_groups: dict[str, list[int]] = defaultdict(list)
    for glyph_id in glyph_proxy_characters:
        outline_groups[glyph_outline_hash(glyph_set, glyph_order[glyph_id])].append(glyph_id)

    overrides = json.loads(PINYIN_OVERRIDES_PATH.read_text(encoding="utf-8"))
    used_overrides: set[str] = set()
    decoded: dict[int, str] = {}
    unresolved: list[str] = []
    for glyph_ids in outline_groups.values():
        proxy_characters = set().union(*(glyph_proxy_characters[glyph_id] for glyph_id in glyph_ids))
        candidate_sets = [proxy_pinyin_candidates(character) for character in proxy_characters]
        candidate_sets = [candidates for candidates in candidate_sets if candidates]
        common = set.intersection(*candidate_sets) if candidate_sets else set()
        proxy_key = "".join(sorted(proxy_characters))
        pronunciation = next(iter(common)) if len(common) == 1 else MANUAL_PINYIN_BY_PROXY_GROUP.get(frozenset(proxy_characters))
        if not pronunciation:
            pronunciation = overrides.get(proxy_key)
            if pronunciation:
                used_overrides.add(proxy_key)
        if not pronunciation:
            unresolved.append("".join(sorted(proxy_characters)))
            continue
        for glyph_id in glyph_ids:
            decoded[glyph_id] = pronunciation

    if unresolved:
        raise RuntimeError(f"Unresolved embedded pinyin glyph groups: {unresolved}")
    unused_overrides = set(overrides) - used_overrides
    if unused_overrides:
        raise RuntimeError(f"Unused source pinyin overrides: {sorted(unused_overrides)}")
    return decoded


def usable_character(character: str) -> bool:
    return bool(character.strip()) and ord(character) >= 32 and not 0xE000 <= ord(character) <= 0xF8FF


def extract_glyphs(page: fitz.Page) -> tuple[list[BodyGlyph], list[PinyinGlyph]]:
    body: list[BodyGlyph] = []
    source_pinyin: list[PinyinGlyph] = []
    for trace in page.get_texttrace():
        font = trace["font"]
        size = float(trace["size"])
        if font == PINYIN_FONT:
            for unicode_value, glyph_id, _origin, bbox in trace["chars"]:
                character = chr(unicode_value)
                if usable_character(character):
                    source_pinyin.append(PinyinGlyph(character, glyph_id, float(bbox[0]), float(bbox[1])))
            continue
        if size < 17 or font in NON_BODY_FONTS:
            continue
        for unicode_value, _glyph_id, _origin, bbox in trace["chars"]:
            character = chr(unicode_value)
            if usable_character(character):
                body.append(
                    BodyGlyph(
                        character=character,
                        x_center=(float(bbox[0]) + float(bbox[2])) / 2,
                        y0=float(bbox[1]),
                        x1=float(bbox[2]),
                    )
                )
    return body, source_pinyin


def align_source_pinyin(
    body: list[BodyGlyph], source_pinyin: list[PinyinGlyph], decoded_pinyin: dict[int, str], pdf_page: int
) -> None:
    """Attach source ruby and restore body glyphs missing from the PDF text map."""
    used: set[int] = set()
    for body_glyph in body:
        if not CHINESE_RE.fullmatch(body_glyph.character):
            continue
        candidates: list[tuple[float, int, PinyinGlyph]] = []
        for index, pinyin_glyph in enumerate(source_pinyin):
            if index in used:
                continue
            dx = abs(pinyin_glyph.x0 - body_glyph.x1)
            dy = abs(pinyin_glyph.y0 - body_glyph.y0)
            if dx < 12 and dy < 8:
                candidates.append((dx + dy, index, pinyin_glyph))
        if not candidates:
            continue
        _, index, pinyin_glyph = min(candidates)
        body_glyph.pronunciation = decoded_pinyin[pinyin_glyph.glyph_id]
        # The aligned source pinyin layer has stable grid coordinates even when
        # a fallback body font reports a displaced bounding box.  Use it as the
        # ordering anchor so those fallback characters stay in their true slot.
        body_glyph.x_center = pinyin_glyph.x0 - 8.25
        body_glyph.y0 = pinyin_glyph.y0
        body_glyph.x1 = pinyin_glyph.x0 + 1.75
        used.add(index)

    unmatched = [(index, glyph) for index, glyph in enumerate(source_pinyin) if index not in used]
    for index, pinyin_glyph in unmatched:
        restored_character = MISSING_BODY_CHAR_BY_PINYIN_PROXY.get(pinyin_glyph.proxy_character)
        if not restored_character:
            raise RuntimeError(
                f"PDF page {pdf_page}: unmatched pinyin proxy {pinyin_glyph.proxy_character!r} "
                f"at ({pinyin_glyph.x0:.2f}, {pinyin_glyph.y0:.2f})"
            )
        body.append(
            BodyGlyph(
                character=restored_character,
                x_center=pinyin_glyph.x0 - 8.25,
                y0=pinyin_glyph.y0,
                x1=pinyin_glyph.x0 + 1.75,
                pronunciation=decoded_pinyin[pinyin_glyph.glyph_id],
                synthetic=True,
            )
        )
        used.add(index)


def order_body_glyphs(glyphs: list[BodyGlyph]) -> list[BodyGlyph]:
    """Read vertical columns top-to-bottom, with columns ordered right-to-left."""
    columns: list[list[BodyGlyph]] = []
    column_centers: list[float] = []
    for glyph in sorted(glyphs, key=lambda item: -item.x_center):
        matching_index = next(
            (index for index, center in enumerate(column_centers) if abs(glyph.x_center - center) <= 4.0),
            None,
        )
        if matching_index is None:
            columns.append([glyph])
            column_centers.append(glyph.x_center)
        else:
            columns[matching_index].append(glyph)
            column_centers[matching_index] = sum(item.x_center for item in columns[matching_index]) / len(columns[matching_index])

    ordered: list[BodyGlyph] = []
    for _, column in sorted(zip(column_centers, columns), key=lambda item: -item[0]):
        ordered.extend(sorted(column, key=lambda item: (item.y0, -item.x_center)))
    return ordered


def annotate(glyphs: list[BodyGlyph]) -> str:
    output: list[str] = []
    for glyph in glyphs:
        character = glyph.character
        escaped_character = html.escape(character, quote=False)
        if CHINESE_RE.fullmatch(character) and glyph.pronunciation:
            output.append(
                f'<ruby><span class="han">{escaped_character}</span><rt>{html.escape(glyph.pronunciation, quote=False)}</rt></ruby>'
            )
        elif character in PUNCTUATION:
            output.append(f'<span class="punctuation">{escaped_character}</span>')
        else:
            output.append(escaped_character)
    return "".join(output)


def section_page_label(section: Section) -> str:
    if section.front_matter:
        return f"PDF 前置第 {section.first_pdf_page}–{section.last_pdf_page} 頁"
    first_printed = section.first_pdf_page - 9
    last_printed = section.last_pdf_page - 9
    if first_printed == last_printed:
        return f"原書第 {first_printed} 頁"
    return f"原書第 {first_printed}–{last_printed} 頁"


def page_identity(pdf_page: int) -> tuple[str, int | None, str, str]:
    if pdf_page <= 9:
        return f"pdf-{pdf_page:03d}", None, f"PDF 前置第 {pdf_page} 頁", f"前置 {pdf_page}"
    printed_page = pdf_page - 9
    return f"printed-{printed_page}", printed_page, f"原書第 {printed_page} 頁", str(printed_page)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def render_facsimile(page: fitz.Page, output_path: Path) -> None:
    """Preserve a source page pixel-for-pixel after deterministic lossless WebP encoding."""
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

    pdf_sha256 = source_sha256(pdf_path)
    if pdf_sha256 != SOURCE_PDF_SHA256:
        raise RuntimeError(f"Unexpected source PDF SHA-256: {pdf_sha256}")

    document = fitz.open(pdf_path)
    if document.page_count != 624:
        raise RuntimeError(f"Expected 624 PDF pages, found {document.page_count}")
    decoded_pinyin = decode_source_pinyin(document)

    content_dir = output_root / "data" / "huayan" / "volume-01"
    facsimile_dir = output_root / "assets" / "facsimiles" / "huayan-01"
    index_sections: list[dict[str, object]] = []
    total_characters = 0
    total_pages = 0
    total_ruby = 0
    restored_body_characters = 0
    facsimile_pdf_pages: list[int] = []
    offline_assets: list[str] = []

    for section in SECTIONS:
        pages: list[dict[str, object]] = []
        section_characters = 0
        section_ruby = 0
        for pdf_page_number in range(section.first_pdf_page, section.last_pdf_page + 1):
            page = document[pdf_page_number - 1]
            page_key, printed_page, page_label, folio_label = page_identity(pdf_page_number)
            body_glyphs, source_pinyin = extract_glyphs(page)
            is_facsimile = section.front_matter or not body_glyphs or not source_pinyin

            if is_facsimile:
                facsimile_name = f"pdf-page-{pdf_page_number:03d}.webp"
                facsimile_path = facsimile_dir / facsimile_name
                render_facsimile(page, facsimile_path)
                relative_facsimile = f"assets/facsimiles/huayan-01/{facsimile_name}"
                pages.append(
                    {
                        "pdfPage": pdf_page_number,
                        "pageKey": page_key,
                        "pageLabel": page_label,
                        "folioLabel": folio_label,
                        "printedPage": printed_page,
                        "charCount": 0,
                        "rubyCount": 0,
                        "restoredBodyCharCount": 0,
                        "textSha256": hashlib.sha256(b"").hexdigest(),
                        "text": "",
                        "html": "",
                        "facsimile": relative_facsimile,
                    }
                )
                facsimile_pdf_pages.append(pdf_page_number)
                offline_assets.append(relative_facsimile)
                continue

            align_source_pinyin(body_glyphs, source_pinyin, decoded_pinyin, pdf_page_number)
            ordered_glyphs = order_body_glyphs(body_glyphs)
            text = "".join(glyph.character for glyph in ordered_glyphs)
            if not CHINESE_RE.search(text):
                raise RuntimeError(f"PDF page {pdf_page_number}: no readable scripture body")
            page_ruby = sum(1 for glyph in ordered_glyphs if glyph.pronunciation)
            page_restored = sum(1 for glyph in ordered_glyphs if glyph.synthetic)
            if page_ruby != len(source_pinyin):
                raise RuntimeError(
                    f"PDF page {pdf_page_number}: {page_ruby} ruby annotations for {len(source_pinyin)} source glyphs"
                )
            text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            pages.append(
                {
                    "pdfPage": pdf_page_number,
                    "pageKey": page_key,
                    "pageLabel": page_label,
                    "folioLabel": folio_label,
                    "printedPage": printed_page,
                    "charCount": len(text),
                    "rubyCount": page_ruby,
                    "restoredBodyCharCount": page_restored,
                    "textSha256": text_hash,
                    "text": text,
                    "html": annotate(ordered_glyphs),
                }
            )
            section_characters += len(text)
            section_ruby += page_ruby
            restored_body_characters += page_restored

        if not pages:
            raise RuntimeError(f"No source pages generated for {section.id}")

        filename = f"{section.id}.json"
        relative_content = f"data/huayan/volume-01/{filename}"
        payload = {
            "id": section.id,
            "title": section.title,
            "shortTitle": section.short_title,
            "sourcePageLabel": section_page_label(section),
            "pageCount": len(pages),
            "charCount": section_characters,
            "rubyCount": section_ruby,
            "pages": pages,
        }
        write_json(content_dir / filename, payload)
        index_sections.append(
            {
                "id": section.id,
                "title": section.title,
                "shortTitle": section.short_title,
                "sourcePageLabel": section_page_label(section),
                "content": relative_content,
                "pageCount": len(pages),
                "charCount": section_characters,
                "rubyCount": section_ruby,
            }
        )
        total_pages += len(pages)
        total_characters += section_characters
        total_ruby += section_ruby

    index_payload = {
        "id": "huayan-01",
        "bookId": "huayan",
        "bookTitle": "大方廣佛華嚴經",
        "volume": "01",
        "volumeLabel": "第一冊",
        "language": "zh-Hant",
        "readingMode": "vertical-rl",
        "annotation": "tone-marked pinyin decoded from the source PDF glyph layer",
        "translator": "唐于闐國三藏沙門實叉難陀譯",
        "sourceUrl": "https://yuandao-world.org/2020/04/14/%E5%A4%A7%E6%96%B9%E5%BB%A3%E4%BD%9B%E8%8F%AF%E5%9A%B4%E7%B6%93-%E6%BC%A2%E8%AA%9E%E6%8B%BC%E9%9F%B3%E7%89%88%E9%9B%BB%E5%AD%90%E6%AA%94%E4%B8%8B%E8%BC%89/",
        "sourcePdf": pdf_path.name,
        "sourcePdfSha256": pdf_sha256,
        "pdfPageCount": document.page_count,
        "pageCount": total_pages,
        "frontMatterPageCount": 9,
        "printedPageCount": 615,
        "textPageCount": total_pages - len(facsimile_pdf_pages),
        "facsimilePageCount": len(facsimile_pdf_pages),
        "charCount": total_characters,
        "rubyCount": total_ruby,
        "restoredBodyCharCount": restored_body_characters,
        "decodedPinyinGlyphCount": len(decoded_pinyin),
        "facsimilePdfPages": facsimile_pdf_pages,
        "offlineAssets": offline_assets,
        "sections": index_sections,
    }
    write_json(output_root / "data" / "huayan" / "volume-01-index.json", index_payload)

    print(f"Built {len(index_sections)} sections, {total_pages} PDF pages, {total_characters} HTML characters")
    print(f"Decoded {total_ruby} source pinyin glyphs and restored {restored_body_characters} body characters")
    print(f"Facsimile fallback pages ({len(facsimile_pdf_pages)}): {facsimile_pdf_pages}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
