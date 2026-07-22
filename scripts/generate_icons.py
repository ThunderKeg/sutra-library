#!/usr/bin/env python3
"""Generate the simple typographic PWA icon set."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "icons"
BACKGROUND = "#263a31"
PAPER = "#f2ead9"
ACCENT = "#b96858"


def find_font() -> str | None:
    candidates = (
        Path("C:/Windows/Fonts/msjh.ttc"),
        Path("C:/Windows/Fonts/msjhbd.ttc"),
        Path("C:/Windows/Fonts/mingliu.ttc"),
        Path("C:/Windows/Fonts/simsun.ttc"),
    )
    return str(next((path for path in candidates if path.exists()), "")) or None


def icon(size: int, maskable: bool = False) -> Image.Image:
    image = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(image)
    inset = int(size * (0.19 if maskable else 0.11))
    border_width = max(2, int(size * 0.012))
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=int(size * 0.04),
        outline=ACCENT,
        width=border_width,
    )
    draw.rounded_rectangle(
        (inset + border_width * 2.3, inset + border_width * 2.3, size - inset - border_width * 2.3, size - inset - border_width * 2.3),
        radius=int(size * 0.025),
        outline=ACCENT,
        width=max(1, border_width // 2),
    )
    font_path = find_font()
    font = ImageFont.truetype(font_path, int(size * 0.42)) if font_path else ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "經", font=font)
    x = (size - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) / 2 - bbox[1] - size * 0.015
    draw.text((x, y), "經", fill=PAPER, font=font)
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    icon(192).save(OUTPUT / "icon-192.png", optimize=True)
    icon(512).save(OUTPUT / "icon-512.png", optimize=True)
    icon(512, maskable=True).save(OUTPUT / "icon-maskable-512.png", optimize=True)
    icon(180).save(OUTPUT / "apple-touch-icon.png", optimize=True)
    print(f"Generated icons in {OUTPUT}")


if __name__ == "__main__":
    main()
