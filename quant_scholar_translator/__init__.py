"""Unified public API for Quant Scholar Translator."""

from .streaming import ConfirmedPrefixBuffer, merge_incremental_text
from .translation import (
    detect_domain,
    hotwords_for_domain,
    load_glossary,
    protect,
    restore,
    translate_openai_compatible,
)

__version__ = "0.4.0"


def translate_text(text: str, source: str = "auto", target: str = "zh", domain: str = "auto") -> str:
    """Translate text through the configured local or professional provider."""
    from .realtime import translate

    return translate(text, source, target, domain)


__all__ = [
    "ConfirmedPrefixBuffer",
    "detect_domain",
    "hotwords_for_domain",
    "load_glossary",
    "merge_incremental_text",
    "protect",
    "restore",
    "translate_openai_compatible",
    "translate_text",
]
