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
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .codex_bridge import run_codex_completion
from .kimi_bridge import run_kimi_completion


ROOT = Path(os.getenv("QS_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()
GLOSSARY_DIR = Path(__file__).resolve().parent / "data" / "glossaries"

DOMAIN_HINTS = {
    "finance": ("portfolio", "asset", "bond", "equity", "valuation", "yield", "coupon", "cash flow", "balance sheet"),
    "quant_finance": ("factor", "alpha", "beta", "backtest", "drawdown", "sharpe", "exposure", "hedging", "martingale measure"),
    "economics": ("inflation", "utility", "equilibrium", "elasticity", "monetary", "fiscal", "unemployment", "gross domestic product"),
    "statistics": ("estimator", "regression", "variance", "likelihood", "hypothesis", "stationary", "p-value", "standard error"),
    "mathematics": ("theorem", "proof", "lemma", "matrix", "eigenvalue", "integral", "sigma-algebra", "brownian motion"),
    "programming": ("function", "class", "runtime", "compiler", "thread", "repository", "dataframe", "exception", "api endpoint"),
}

PROTECTED_PATTERNS = re.compile(
    r"(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|"
    r"\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|https?://\S+|doi:\s*\S+|"
    r"\[[0-9,;\-–—\s]+\]|\b[A-Z]{2,6}\d{0,4}\b|\b[A-Z]\d{1,4}\b|"
    r"\b[A-Z](?=\s*[=<>+*/])|\b\w+\([^\n()]{0,80}\)|"
    r"(?<![\w.])[+\-]?\d+(?:[.,]\d+)*(?:\s?(?:%|bp|bps|USD|EUR|CNY|RMB))?)"
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
    # Some local MT tokenizers strip the decorative brackets. Parse complete
    # marker indexes so marker 1 cannot accidentally rewrite marker 10.
    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        return values[index] if index < len(values) else match.group(0)

    return re.sub(r"⟪?QS_PROTECTED_(\d+)⟫?", replace, text)


def restore_checked(text: str, values: list[str]) -> str:
    """Restore protected technical tokens and reject silent model omissions."""
    missing = [
        index
        for index, value in enumerate(values)
        if (
            not re.search(rf"QS_PROTECTED_{index}(?!\d)", text)
            and value not in text
        )
    ]
    if missing:
        raise ValueError(f"translation omitted {len(missing)} protected formula/number/code token(s)")
    return restore(text, values)


def contextual_user_text(text: str, context: str = "", protected_values: list[str] | None = None) -> str:
    context = str(context or "").strip()[-1600:]
    token_map = {
        f"⟪QS_PROTECTED_{index}⟫": value
        for index, value in enumerate(protected_values or [])
    }
    sections = []
    if context:
        sections.append(
            "Previous source context for disambiguation only; do not translate or repeat it:\n"
            f"{context}"
        )
    if token_map:
        sections.append(
            "Protected token map for terminology interpretation only; reproduce each marker exactly:\n"
            + json.dumps(token_map, ensure_ascii=False)
        )
    sections.append(f"Text to translate:\n{text}")
    return "\n\n".join(sections)


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


def normalize_term(value: str) -> str:
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[-–—‑]", " ", value.replace("’", "'").lower())).strip()


def select_glossary(entries: list[dict], text: str, limit: int = 40) -> list[dict]:
    """Match whole terms/aliases in original context, favoring specific phrases."""
    normalized = normalize_term(text)
    ranked = []
    for index, item in enumerate(entries):
        score = 0
        for alias in [item["source"], *item.get("aliases", [])]:
            term = normalize_term(alias)
            if term and re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", normalized):
                score = max(score, len(term))
        if score:
            ranked.append((-score, index, item))
    return [item for _, _, item in sorted(ranked, key=lambda row: row[:2])[:limit]]


def relevant_glossary(text: str, domain: str, limit: int = 40) -> list[dict]:
    # A quant paragraph may also contain mathematics/statistics terminology.
    requested_domain = domain if domain not in ("", "auto", None) else None
    primary_domain = requested_domain or detect_domain(text)
    names = [primary_domain, *[name for name in ["academic", *DOMAIN_HINTS] if name != primary_domain]]
    candidates, seen_names = [], set()
    for name in names:
        if name in seen_names:
            continue
        seen_names.add(name)
        candidates.extend({**item, "domain": name} for item in load_glossary(name))
    ranked = select_glossary(candidates, text, len(candidates))
    normalized_text = normalize_term(text)

    def matched_terms(item: dict) -> list[str]:
        return [
            term for alias in [item["source"], *item.get("aliases", [])]
            if (term := normalize_term(alias))
            and re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", normalized_text)
        ]

    matches = {id(item): matched_terms(item) for item in ranked}
    alias_groups: dict[str, list[dict]] = {}
    for item in ranked:
        for term in matches[id(item)]:
            alias_groups.setdefault(term, []).append(item)

    evidence: dict[str, int] = {}
    for item in ranked:
        evidence[item["domain"]] = evidence.get(item["domain"], 0) + max(map(len, matches[id(item)]), default=0)

    allowed = {id(item) for item in ranked}
    for item in ranked:
        if not item.get("requiresContext") or not item.get("domain"):
            continue
        # Explicit user domain choice is authoritative. In automatic mode,
        # require independent same-domain evidence before applying a generic
        # professional sense (for example duration -> 久期).
        own_score = max(map(len, matches[id(item)]), default=0)
        independent_evidence = evidence.get(item["domain"], 0) - own_score
        if requested_domain != item["domain"] and independent_evidence <= 0:
            allowed.discard(id(item))
    for rows in alias_groups.values():
        targets = {item["target"] for item in rows}
        if len(targets) <= 1:
            continue
        # An explicitly selected domain is authoritative. In automatic mode,
        # use other matched terminology as evidence. If still tied, omit every
        # conflicting hint rather than feeding the model contradictory rules.
        preferred = [item for item in rows if item["domain"] == requested_domain]
        if len(preferred) == 1:
            allowed.difference_update(id(item) for item in rows if item is not preferred[0])
            continue
        scores = [evidence.get(item["domain"], 0) for item in rows]
        best = max(scores)
        if scores.count(best) == 1:
            winner = rows[scores.index(best)]
            allowed.difference_update(id(item) for item in rows if item is not winner)
        else:
            allowed.difference_update(id(item) for item in rows)

    return [item for item in ranked if id(item) in allowed][:limit]


def glossary_prompt(entries: list[dict], limit: int = 40) -> str:
    return "\n".join(
        f"- {item['source']} => {item['target']} [{item.get('domain', '')}]"
        f" ({item.get('note', '')})"
        + (f"; aliases: {', '.join(item['aliases'])}" if item.get('aliases') else "")
        + (f"; accepted target variants: {', '.join(item['targetVariants'])}" if item.get('targetVariants') else "")
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
    context: str = "",
) -> str:
    selected_domain = detect_domain(text) if domain in ("", "auto", None) else domain
    protected = protect(text)
    system = f"""You are a professional translator for {selected_domain} learning material.
Translate every sentence in the supplied text, in order. Never summarize, select highlights, or omit repeated examples or qualifications.
Translate from {source_lang or 'auto-detected language'} to {target_lang}.
Preserve every ⟪QS_PROTECTED_n⟫ token exactly. Preserve numbers, equations,
variable names, citations, ticker symbols and code. Prefer established Chinese
academic terminology. Do not add explanations. Use the glossary contextually;
for an unambiguous glossary match, use its preferred Chinese target exactly.
at the first occurrence of a recognized technical acronym, write the preferred
Chinese term followed by the source acronym in parentheses. Do not leave a
glossary-recognized acronym unexplained; preserve standard symbols and code.
do not perform blind word replacement. Return translation text only.

Glossary:
{glossary_prompt(relevant_glossary(text + ' ' + context, selected_domain))}"""
    payload = json.dumps({
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": contextual_user_text(protected.text, context, protected.values)},
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
    return restore_checked(output, protected.values)


def translate_codex_subscription(
    text: str,
    source_lang: str,
    target_lang: str,
    domain: str,
    *,
    timeout: int | None = None,
    context: str = "",
) -> str:
    """Use the same medium/high review policy for a plain-text paragraph."""
    # Lazy import avoids the caption helper's glossary import cycle.
    from .caption_translation import translate_cues
    rows = translate_cues(
        [{"id": "paragraph", "text": text}], source_lang, target_lang,
        domain, "codex_subscription", context, timeout=timeout,
        _codex_runner=run_codex_completion,
    )
    return rows[0]["text"]


def translate_kimi_subscription(
    text: str,
    source_lang: str,
    target_lang: str,
    domain: str,
    *,
    timeout: int | None = None,
    context: str = "",
) -> str:
    """Translate through the locally installed, OAuth-authenticated Kimi Code CLI."""
    selected_domain = detect_domain(text) if domain in ("", "auto", None) else domain
    protected = protect(text)
    system = f"""You are a professional translator for {selected_domain} learning material.
Translate every sentence in the supplied text, in order. Never summarize, select highlights, or omit repeated examples or qualifications.
Translate from {source_lang or 'auto-detected language'} to {target_lang}.
Preserve every ⟪QS_PROTECTED_n⟫ token exactly. Preserve numbers, equations,
variable names, citations, ticker symbols and code. Prefer established Chinese
academic terminology. Do not add explanations. Use the glossary contextually;
for an unambiguous glossary match, use its preferred Chinese target exactly.
at the first occurrence of a recognized technical acronym, write the preferred
Chinese term followed by the source acronym in parentheses. Do not leave a
glossary-recognized acronym unexplained; preserve standard symbols and code.
do not perform blind word replacement. Return translation text only.

Glossary:
{glossary_prompt(relevant_glossary(text + ' ' + context, selected_domain))}"""
    output = run_kimi_completion(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": contextual_user_text(protected.text, context, protected.values)},
        ],
        timeout=timeout,
    )
    return restore_checked(output.strip(), protected.values)
