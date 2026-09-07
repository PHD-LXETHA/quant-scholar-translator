"""OCR a scanned PDF and add an invisible, positioned English text layer.

The source PDF is never modified.  A JSON sidecar is written for token
estimation and audit, and the generated searchable PDF can be passed to the
layout-preserving PDF translator.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quant_scholar_translator.ocr import recognize_image


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--render-width", type=int, default=1800)
    parser.add_argument("--minimum-score", type=float, default=0.45)
    args = parser.parse_args()

    source = args.input.resolve(strict=True)
    output = args.output.resolve()
    audit = (args.audit or output.with_suffix(".ocr.json")).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    audit.parent.mkdir(parents=True, exist_ok=True)

    document = pymupdf.open(source)
    records: list[dict] = []
    total_chars = total_words = total_lines = 0
    try:
        for page_index, page in enumerate(document):
            scale = max(0.5, args.render_width / max(1.0, page.rect.width))
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            result = recognize_image(pixmap.tobytes("jpeg"), minimum_score=args.minimum_score)
            lines = []
            sx = page.rect.width / max(1, result["width"])
            sy = page.rect.height / max(1, result["height"])
            for raw in result["lines"]:
                text = clean_text(raw.get("text"))
                if len(text) < 2:
                    continue
                x = max(0.0, float(raw["x"]) * sx)
                y = max(0.0, float(raw["y"]) * sy)
                width = max(2.0, float(raw["width"]) * sx)
                height = max(5.0, float(raw["height"]) * sy)
                rect = pymupdf.Rect(x, y, min(page.rect.width, x + width), min(page.rect.height, y + height * 1.18))
                font_size = max(5.0, min(height * 0.78, 60.0))
                remaining = page.insert_textbox(
                    rect,
                    text,
                    fontsize=font_size,
                    fontname="helv",
                    render_mode=3,
                    overlay=True,
                )
                if remaining < 0:
                    page.insert_text(
                        pymupdf.Point(x, min(page.rect.height - 1, y + height * 0.82)),
                        text,
                        fontsize=max(4.0, font_size * 0.8),
                        fontname="helv",
                        render_mode=3,
                        overlay=True,
                    )
                line = {
                    "text": text,
                    "score": raw.get("score"),
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "width": round(width, 2),
                    "height": round(height, 2),
                }
                lines.append(line)
                total_chars += len(text)
                total_words += len(re.findall(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*", text))
            total_lines += len(lines)
            records.append({
                "page": page_index + 1,
                "pageWidth": round(page.rect.width, 2),
                "pageHeight": round(page.rect.height, 2),
                "lines": lines,
            })
            print(f"OCR {page_index + 1}/{len(document)}: {len(lines)} lines", flush=True)

        document.save(output, garbage=4, deflate=True)
    finally:
        document.close()

    summary = {
        "source": str(source),
        "searchablePdf": str(output),
        "pages": len(records),
        "lines": total_lines,
        "sourceChars": total_chars,
        "sourceWords": total_words,
        "estimatedSourceTokens": round(total_chars / 4),
        "records": records,
    }
    audit.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "records"}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
