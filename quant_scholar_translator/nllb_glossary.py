"""Small, cached terminology allowlist for English-to-Chinese local previews.

Translations still come from the seven maintained glossaries. Only reviewed
multiword expressions qualify; formulas, code and numbers are protected first.
This is inference-time protection, not model training or constrained decoding.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from .translation import GLOSSARY_DIR, ProtectedText, normalize_term, restore_checked

MAX_TERM_OCCURRENCES = 4
ALLOWLIST_PATH = Path(__file__).parent / 'data' / 'nllb-safe-terms.json'


def _pattern(term):
    return re.compile(r'(?<![\w])' + r'[\s\-–—‑]+'.join(re.escape(word) for word in term.split()) + r'(?![\w])', re.IGNORECASE)


@lru_cache(maxsize=1)
def _index():
    allowlist = json.loads(ALLOWLIST_PATH.read_text(encoding='utf-8'))
    spellings, approved = {}, set()
    for path in sorted(GLOSSARY_DIR.glob('*.json')):
        for entry in json.loads(path.read_text(encoding='utf-8')):
            variants = {normalize_term(s) for s in [entry['source'], *entry.get('aliases', [])]}
            for variant in variants:
                spellings.setdefault(variant, set()).add(entry['target'])
            if entry['source'] in allowlist.get(path.stem, []) and not entry.get('requiresContext'):
                approved.update(variants)
    safe = {term: next(iter(spellings[term])) for term in approved
            if len(term.split()) >= 2 and len(spellings[term]) == 1}
    if not safe:
        return None, {}, ()
    # One compiled matcher, rather than loading and scanning every glossary on
    # every audio chunk. Longest phrases have priority at the same position.
    alternatives = [_pattern(term).pattern for term in sorted(safe, key=lambda term: (-len(term), term))]
    matcher = re.compile('|'.join(alternatives), re.IGNORECASE)
    # Do not protect only a suffix of a more specific known concept, e.g.
    # "confidence interval" inside "bootstrap confidence interval".
    blockers = tuple(_pattern(term) for term in spellings if term not in safe and
                     any(re.search(r'(?<!\w)' + re.escape(candidate) + r'(?!\w)', term) for candidate in safe))
    return matcher, safe, blockers


def protect_terms(base: ProtectedText, source_lang: str, target_lang: str) -> ProtectedText:
    if source_lang.lower() not in {'en', 'en-us', 'en-gb', 'eng'} or target_lang.lower() not in {'zh', 'zh-cn', 'zh-hans'}:
        return base
    matcher, targets, blockers = _index()
    if matcher is None:
        return base
    matches = list(matcher.finditer(base.text))
    if not matches:
        return base
    blocked = [match.span() for pattern in blockers for match in pattern.finditer(base.text)]
    values = list(base.values)
    pieces, cursor, count = [], 0, 0
    for match in matches:
        if any(start <= match.start() and end >= match.end() for start, end in blocked):
            continue
        pieces.extend([base.text[cursor:match.start()], f'⟪QS_PROTECTED_{len(values)}⟫'])
        values.append(targets[normalize_term(match.group())])
        cursor = match.end()
        count += 1
        if count == MAX_TERM_OCCURRENCES:
            break
    if not count:
        return base
    pieces.append(base.text[cursor:])
    return ProtectedText(''.join(pieces), values)


def restore_terms(output: str, protected: ProtectedText, original_count: int) -> str:
    # Require exactly one occurrence of every added terminology marker. If the
    # model duplicates, loses or invents a marker, the caller retries plain NLLB.
    markers = re.findall(r'QS_PROTECTED_(\d+)', output)
    if any(int(marker) >= len(protected.values) for marker in markers):
        raise ValueError('NLLB returned an unknown protection marker')
    if any(markers.count(str(index)) != 1 for index in range(original_count, len(protected.values))):
        raise ValueError('NLLB did not preserve terminology alignment')
    return restore_checked(output, protected.values)
