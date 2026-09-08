"""Download and verify the local models used by Quant Scholar."""
from __future__ import annotations

import argparse
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODELS_ROOT = PROJECT_ROOT / ".models"
os.environ.setdefault("QS_PROJECT_ROOT", str(PROJECT_ROOT))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "1800")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def download_whisper() -> None:
    from faster_whisper import WhisperModel

    runtime_model = MODELS_ROOT / "whisper-large-v3-turbo"
    if (runtime_model / "model.bin").exists():
        print(f"Using existing compact Whisper model at {runtime_model}")
        model_source = str(runtime_model)
        destination = MODELS_ROOT / "whisper"
    else:
        destination = MODELS_ROOT / "whisper"
        model_source = "large-v3-turbo"
    destination.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(
        model_source,
        device="cuda",
        compute_type="float16",
        download_root=str(destination),
    )
    print(f"Whisper GPU model loaded: {model.model.device}")


def convert_nllb() -> None:
    cache = MODELS_ROOT / "huggingface-build-cache"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(cache / "hub")
    from quant_scholar_translator import realtime

    bundle = realtime._get_nllb()
    if bundle is None:
        raise RuntimeError("NLLB conversion or load failed")
    translated = realtime._translate_nllb("expected return and risk premium", "en", "zh")
    print(f"NLLB int8 verification: {translated}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--whisper", action="store_true")
    parser.add_argument("--nllb", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    selected = args.all or not (args.whisper or args.nllb)
    if selected or args.whisper:
        download_whisper()
    if selected or args.nllb:
        convert_nllb()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
