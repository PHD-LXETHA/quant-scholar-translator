"""Domain-aware translation helpers for technical learning material.

This module is original project code. It keeps formulas, code fragments, URLs,
citations and ticker-like identifiers out of the translation model's reach and
adds a compact, domain-specific glossary to each request.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .codex_bridge import run_codex_completion
from .kimi_bridge import run_kimi_completion


ROOT = Path(os.getenv("QS_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()
GLOSSARY_DIR = Path(__file__).resolve().parent / "data" / "glossaries"

DOMAIN_HINTS = {
    "finance": ("portfolio", "asset", "bond", "equity", "valuation", "yield", "return"),
    "quant_finance": ("factor", "alpha", "beta", "backtest", "drawdown", "sharpe", "exposure"),
    "economics": ("inflation", "utility", "equilibrium", "elasticity", "monetary", "fiscal"),
    "statistics": ("estimator", "regression", "variance", "likelihood", "hypothesis", "stationary"),
    "mathematics": ("theorem", "proof", "lemma", "matrix", "eigenvalue", "integral"),
    "programming": ("function", "class", "runtime", "compiler", "thread", "repository"),
}

PROTECTED_PATTERNS = re.compile(
    r"(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|"
    r"\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|https?://\S+|doi:\s*\S+|"
    r"\[[0-9,;\-–—\s]+\]|\b[A-Z]{1,6}\d{0,4}\b|\b\w+\([^\n()]{0,80}\))"
)


@dataclass
class ProtectedText:
    text: str
    values: list[str]


def protect(text: str) -> ProtectedText:
    values: list[str] = []

    def replace(match: re.Match[str]) -> str:
        values.append(match.group(0))
        return f"⟪QS_PROTECTED_{len(values) - 1}⟫"

    return ProtectedText(PROTECTED_PATTERNS.sub(replace, text), values)


def restore(text: str, values: list[str]) -> str:
    for index, value in enumerate(values):
        text = text.replace(f"⟪QS_PROTECTED_{index}⟫", value)
    return text


def detect_domain(text: str) -> str:
    lower = text.lower()
    scores = {name: sum(lower.count(term) for term in terms) for name, terms in DOMAIN_HINTS.items()}
    winner = max(scores, key=scores.get)
    return winner if scores[winner] else "academic"


def load_glossary(domain: str) -> list[dict]:
    path = GLOSSARY_DIR / f"{domain}.json"
    if not path.exists():
        path = GLOSSARY_DIR / "academic.json"
    return json.loads(path.read_text(encoding="utf-8"))


def hotwords_for_domain(domain: str, limit: int = 80) -> str:
    """Build a compact Whisper hotword prompt from the maintained glossaries.

    The auto profile deliberately combines every subject area: the recognizer
    sees unusual technical phrases before domain detection has enough text to
    choose a single subject.
    """
    if domain in ("", "auto", None):
        names = ["finance", "quant_finance", "economics", "statistics", "mathematics", "programming"]
    else:
        names = [domain]
    words: list[str] = []
    seen: set[str] = set()
    grouped = [load_glossary(name) for name in names]
    depth = 0
    while len(words) < limit and any(depth < len(entries) for entries in grouped):
        for entries in grouped:
            if depth >= len(entries):
                continue
            item = entries[depth]
            source = str(item.get("source", "")).strip()
            key = source.casefold()
            if source and key not in seen:
                seen.add(key)
                words.append(source)
            if len(words) >= limit:
                return ", ".join(words)
        depth += 1
    return ", ".join(words)


def glossary_prompt(entries: list[dict], limit: int = 40) -> str:
    return "\n".join(
        f"- {item['source']} => {item['target']} ({item.get('note', '')})"
        for item in entries[:limit]
    )


def translate_openai_compatible(
    text: str,
    source_lang: str,
    target_lang: str,
    domain: str,
    *,
    api_base: str,
    api_key: str,
    model: str,
    timeout: int = 45,
) -> str:
    selected_domain = detect_domain(text) if domain in ("", "auto", None) else domain
    protected = protect(text)
    system = f"""You are a professional translator for {selected_domain} learning material.
Translate from {source_lang or 'auto-detected language'} to {target_lang}.
Preserve every ⟪QS_PROTECTED_n⟫ token exactly. Preserve numbers, equations,
variable names, citations, ticker symbols and code. Prefer established Chinese
academic terminology. Do not add explanations. Use the glossary contextually;
do not perform blind word replacement. Return translation text only.

Glossary:
{glossary_prompt(load_glossary(selected_domain))}"""
    payload = json.dumps({
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": protected.text},
        ],
    }).encode("utf-8")
    url = api_base.rstrip("/") + "/chat/completions"
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = json.loads(response.read().decode("utf-8"))
    output = result["choices"][0]["message"]["content"].strip()
    return restore(output, protected.values)


def translate_codex_subscription(
    text: str,
    source_lang: str,
    target_lang: str,
    domain: str,
    *,
    timeout: int | None = None,
) -> str:
    """Translate through the locally installed, ChatGPT-authenticated Codex CLI."""
    selected_domain = detect_domain(text) if domain in ("", "auto", None) else domain
    protected = protect(text)
    system = f"""You are a professional translator for {selected_domain} learning material.
Translate from {source_lang or 'auto-detected language'} to {target_lang}.
Preserve every ⟪QS_PROTECTED_n⟫ token exactly. Preserve numbers, equations,
variable names, citations, ticker symbols and code. Prefer established Chinese
academic terminology. Do not add explanations. Use the glossary contextually;
do not perform blind word replacement. Return translation text only.

Glossary:
{glossary_prompt(load_glossary(selected_domain))}"""
    output = run_codex_completion(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": protected.text},
        ],
        timeout=timeout,
    )
    return restore(output.strip(), protected.values)


def translate_kimi_subscription(
    text: str,
    source_lang: str,
    target_lang: str,
    domain: str,
    *,
    timeout: int | None = None,
) -> str:
    """Translate through the locally installed, OAuth-authenticated Kimi Code CLI."""
    selected_domain = detect_domain(text) if domain in ("", "auto", None) else domain
    protected = protect(text)
    system = f"""You are a professional translator for {selected_domain} learning material.
Translate from {source_lang or 'auto-detected language'} to {target_lang}.
Preserve every ⟪QS_PROTECTED_n⟫ token exactly. Preserve numbers, equations,
variable names, citations, ticker symbols and code. Prefer established Chinese
academic terminology. Do not add explanations. Use the glossary contextually;
do not perform blind word replacement. Return translation text only.

Glossary:
{glossary_prompt(load_glossary(selected_domain))}"""
    output = run_kimi_completion(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": protected.text},
        ],
        timeout=timeout,
    )
    return restore(output.strip(), protected.values)
