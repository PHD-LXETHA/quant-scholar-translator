"""Unified public API for Quant Scholar Translator."""

from .streaming import ConfirmedPrefixBuffer, merge_incremental_text
from .translation import (
    detect_domain,
    hotwords_for_domain,
    load_glossary,
    protect,
    restore,
    restore_checked,
    translate_openai_compatible,
    translate_codex_subscription,
    translate_kimi_subscription,
)

__version__ = "0.8.2"


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
    "restore_checked",
    "translate_openai_compatible",
    "translate_codex_subscription",
    "translate_kimi_subscription",
    "translate_text",
]
