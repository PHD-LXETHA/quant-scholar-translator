"""Local OCR for scanned research-PDF pages.

The OCR engine and its ONNX models stay on the user's computer.  This module
returns positioned text lines; professional translation remains a separate
Codex/Kimi step so OCR output is never mistaken for a finished translation.
"""
from __future__ import annotations

import io
import threading
from typing import Any, Callable

from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_IMAGE_PIXELS = 30_000_000
MAX_OCR_LINES = 5000
_ENGINE: Any = None
_ENGINE_LOCK = threading.Lock()


class OcrUnavailableError(RuntimeError):
    """Raised when the optional local OCR runtime is unavailable."""


def _load_engine():
    global _ENGINE
    if _ENGINE is None:
        try:
            from rapidocr import RapidOCR
        except ImportError as error:
            raise OcrUnavailableError(
                "本地 OCR 组件未安装，请重新运行 setup.ps1 后重试。"
            ) from error
        _ENGINE = RapidOCR()
    return _ENGINE


def _image_size(image_bytes: bytes) -> tuple[int, int]:
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("OCR 页面图像为空或超过 16 MB")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise ValueError("OCR 页面尺寸无效或超过 3000 万像素")
            image.verify()
            return width, height
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("OCR 页面不是有效图像") from error


def recognize_image(image_bytes: bytes, *, minimum_score: float = 0.45,
                    engine_factory: Callable[[], Any] | None = None) -> dict:
    """Recognize one rendered PDF page and return bounded positioned lines."""
    width, height = _image_size(image_bytes)
    threshold = min(0.95, max(0.1, float(minimum_score)))
    engine = engine_factory() if engine_factory else _load_engine()
    with _ENGINE_LOCK:
        result = engine(image_bytes, text_score=threshold)
    boxes = getattr(result, "boxes", None)
    texts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is None or texts is None or scores is None:
        return {"width": width, "height": height, "lines": []}
    lines = []
    for box, raw_text, raw_score in zip(boxes, texts, scores):
        text = " ".join(str(raw_text or "").split())
        score = float(raw_score or 0)
        if not text or score < threshold:
            continue
        points = list(box)
        if len(points) < 4:
            continue
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        left, top = max(0.0, min(xs)), max(0.0, min(ys))
        right, bottom = min(float(width), max(xs)), min(float(height), max(ys))
        if right <= left or bottom <= top:
            continue
        lines.append({
            "text": text,
            "score": round(score, 4),
            "x": round(left, 2),
            "y": round(top, 2),
            "width": round(right - left, 2),
            "height": round(bottom - top, 2),
        })
        if len(lines) >= MAX_OCR_LINES:
            break
    lines.sort(key=lambda line: (line["y"], line["x"]))
    return {"width": width, "height": height, "lines": lines}
