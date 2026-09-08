"""Build an interleaved original-page plus clean Chinese-reading-page PDF."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pymupdf


def pick_chinese_font() -> Path:
    candidates = [
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsunb.ttf"),
        Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf"),
    ]
    font = next((item for item in candidates if item.exists()), None)
    if font is None:
        raise FileNotFoundError("No compatible Simplified Chinese TTF font was found")
    return font


def clean_text(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text.replace("\u2011", "-")


def wrap_text(text: str, font: pymupdf.Font, size: float, width: float) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    lines: list[str] = []
    current = ""
    last_break = -1
    for character in text:
        candidate = current + character
        if font.text_length(candidate, fontsize=size) <= width or not current:
            current = candidate
            if character.isspace() or character in "，。；：！？、,.!?;:)]}》】":
                last_break = len(current)
            continue
        if last_break > 0 and last_break >= len(current) * 0.55:
            lines.append(current[:last_break].strip())
            current = current[last_break:].lstrip() + character
        else:
            lines.append(current.rstrip())
            current = character.lstrip()
        last_break = -1
        for index, value in enumerate(current, 1):
            if value.isspace() or value in "，。；：！？、,.!?;:)]}》】":
                last_break = index
    if current.strip():
        lines.append(current.strip())
    return lines


def style_for(role: str, page_width: float) -> tuple[float, float, tuple[float, float, float]]:
    scale = max(0.82, min(1.35, page_width / 1800))
    if role == "heading":
        return 29 * scale, 1.28, (0.04, 0.08, 0.10)
    if role == "metadata":
        return 17 * scale, 1.35, (0.25, 0.34, 0.38)
    if role == "caption":
        return 16 * scale, 1.38, (0.30, 0.36, 0.38)
    return 20 * scale, 1.46, (0.08, 0.12, 0.14)


def build_translation_pages(
    output: pymupdf.Document,
    source_number: int,
    source_rect: pymupdf.Rect,
    entries: list[dict],
    font_path: Path,
) -> list[int]:
    width, height = source_rect.width, source_rect.height
    margin_x = width * 0.06
    top = height * 0.065
    bottom = height * 0.055
    gap = width * 0.035
    column_width = (width - 2 * margin_x - gap) / 2
    font = pymupdf.Font(fontfile=str(font_path))
    pages: list[int] = []
    page: pymupdf.Page | None = None
    column = 0
    cursor_y = top

    def new_page() -> pymupdf.Page:
        nonlocal column, cursor_y
        created = output.new_page(width=width, height=height)
        created.insert_font(fontname="qszh", fontfile=str(font_path), set_simple=False)
        created.draw_rect(created.rect, color=None, fill=(0.975, 0.97, 0.95))
        created.insert_text(
            (margin_x, top * 0.58),
            f"原刊第 {source_number} 页  |  中文阅读版",
            fontname="qszh",
            fontsize=max(16, width / 78),
            color=(0.07, 0.34, 0.32),
        )
        created.draw_line(
            (margin_x, top * 0.76),
            (width - margin_x, top * 0.76),
            color=(0.35, 0.62, 0.58),
            width=max(1, width / 1200),
        )
        column = 0
        cursor_y = top
        pages.append(created.number + 1)
        return created

    for entry in entries:
        text = clean_text(entry.get("translation"))
        if not text:
            continue
        size, line_factor, color = style_for(entry.get("role", "body"), width)
        lines = wrap_text(text, font, size, column_width)
        if not lines:
            continue
        line_height = size * line_factor
        before = size * (0.62 if entry.get("role") == "heading" else 0.34)
        after = size * (0.55 if entry.get("role") == "heading" else 0.44)
        needed = before + len(lines) * line_height + after
        usable_bottom = height - bottom
        if page is None:
            page = new_page()
        if cursor_y + needed > usable_bottom:
            if column == 0:
                column = 1
                cursor_y = top
            else:
                page = new_page()
        x = margin_x + column * (column_width + gap)
        cursor_y += before
        for line in lines:
            if cursor_y + line_height > usable_bottom:
                if column == 0:
                    column = 1
                    cursor_y = top
                else:
                    page = new_page()
                x = margin_x + column * (column_width + gap)
            page.insert_text(
                (x, cursor_y + size),
                line,
                fontname="qszh",
                fontsize=size,
                color=color,
            )
            cursor_y += line_height
        cursor_y += after
    return pages


def build(source_path: Path, blocks_path: Path, checkpoint_path: Path, output_path: Path) -> None:
    source = pymupdf.open(source_path)
    block_data = json.loads(blocks_path.read_text(encoding="utf-8"))
    translations = json.loads(checkpoint_path.read_text(encoding="utf-8")).get("translations", {})
    by_page = {int(page["page"]): page for page in block_data.get("pages", [])}
    output = pymupdf.open()
    toc: list[list[object]] = []
    font_path = pick_chinese_font()
    try:
        for index, source_page in enumerate(source):
            source_number = index + 1
            output.insert_pdf(source, from_page=index, to_page=index)
            toc.append([1, f"原刊第 {source_number} 页", output.page_count])
            entries = []
            for block in by_page.get(source_number, {}).get("blocks", []):
                translated = clean_text(translations.get(block.get("id")))
                if translated:
                    entries.append({**block, "translation": translated})
            translated_pages = build_translation_pages(
                output, source_number, source_page.rect, entries, font_path
            )
            if translated_pages:
                toc.append([2, "中文阅读版", translated_pages[0]])
            print(
                f"PAGE {source_number}/{len(source)}: {len(entries)} translated blocks, "
                f"{len(translated_pages)} reading pages",
                flush=True,
            )
        output.set_toc(toc)
        output.subset_fonts()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output.save(output_path, garbage=4, deflate=True)
    finally:
        output.close()
        source.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("blocks", type=Path)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(
        args.source.resolve(strict=True),
        args.blocks.resolve(strict=True),
        args.checkpoint.resolve(strict=True),
        args.output.resolve(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
