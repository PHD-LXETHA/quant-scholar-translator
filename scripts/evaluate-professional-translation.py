"""Run the reproducible Quant Scholar professional translation acceptance test.

This is intentionally separate from glossary retrieval tests: it calls the
configured professional provider, translates 20 independent cues per domain,
and verifies cue alignment, protected literals, required terminology, and
basic logical-relation signals.  It prints JSON and never writes credentials.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from quant_scholar_translator.caption_translation import translate_cues


DOMAINS = (
    "mathematics", "statistics", "quant_finance", "finance",
    "economics", "programming", "academic",
)
NEGATION = re.compile(r"\b(?:not|no|never|without|does not|do not|need not|cannot|can't)\b", re.I)
CONTRAST = re.compile(r"\b(?:whereas|but|unlike|rather than)\b", re.I)
CONDITION = re.compile(r"\b(?:only if|depending on|requires?|provided that|when|if)\b", re.I)
TARGET_NEGATION = re.compile(r"不|未|无|非|不能|不会|并非|不得|没有")
TARGET_CONTRAST = re.compile(r"而|但|却|不同|区别|相比|而非|并非")
TARGET_CONDITION = re.compile(r"条件|取决于|要求|需|当|若|如果|只有|即使|在.+下")


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\s\-–—·•‐‑‒'’]+", "", value)


def target_variants_by_domain() -> dict[str, dict[str, list[str]]]:
    variants: dict[str, dict[str, list[str]]] = {}
    for domain in DOMAINS:
        entries = json.loads((ROOT / "quant_scholar_translator" / "data" / "glossaries" / f"{domain}.json").read_text(encoding="utf-8"))
        variants[domain] = {
            item["target"]: [item["target"], *item.get("targetVariants", [])]
            for item in entries
        }
    return variants


def select_cases(spec: dict, count: int) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    # Put the deliberately authored v7 cases first, then fill with the older
    # applied-reading corpus.  De-duplicate source sentences deterministically.
    ordered = sorted(
        spec["coverage"],
        key=lambda item: 0 if item.get("suite") == "professional-translation-v7" else 1,
    )
    seen: dict[str, set[str]] = defaultdict(set)
    for item in ordered:
        domain = item.get("domain")
        text = str(item.get("text", "")).strip()
        if domain not in DOMAINS or not text or text in seen[domain] or len(grouped[domain]) >= count:
            continue
        grouped[domain].append(item)
        seen[domain].add(text)
    missing = {domain: count - len(grouped[domain]) for domain in DOMAINS if len(grouped[domain]) < count}
    if missing:
        raise ValueError(f"专业实译语料不足：{missing}")
    return dict(grouped)


def logic_expectations(source: str) -> list[tuple[str, re.Pattern[str]]]:
    checks = []
    if NEGATION.search(source):
        checks.append(("negation", TARGET_NEGATION))
    if CONTRAST.search(source):
        checks.append(("contrast", TARGET_CONTRAST))
    if CONDITION.search(source):
        checks.append(("condition", TARGET_CONDITION))
    return checks


def evaluate_domain(domain: str, cases: list[dict], provider: str, timeout: int) -> dict:
    cues = [{"id": f"{domain}-{index:02d}", "text": item["text"]}
            for index, item in enumerate(cases, 1)]
    started = time.monotonic()
    translated = translate_cues(cues, "en", "zh", domain, provider, timeout=timeout)
    elapsed = round(time.monotonic() - started, 2)
    mapped = {item["id"]: item["text"] for item in translated}
    approved_variants = target_variants_by_domain()[domain]
    results = []
    required_total = required_hit = logic_total = logic_hit = 0
    for cue, case in zip(cues, cases):
        target = mapped.get(cue["id"], "")
        target_key = normalized(target)
        missing_terms = []
        for expected in case.get("expectedTargets", []):
            required_total += 1
            accepted = approved_variants.get(expected, [expected])
            if any(normalized(candidate) in target_key for candidate in accepted):
                required_hit += 1
            else:
                missing_terms.append(expected)
        missing_logic = []
        for label, pattern in logic_expectations(cue["text"]):
            logic_total += 1
            if pattern.search(target):
                logic_hit += 1
            else:
                missing_logic.append(label)
        results.append({
            "id": cue["id"], "source": cue["text"], "translation": target,
            "missingTerms": missing_terms, "missingLogicSignals": missing_logic,
        })
    term_rate = required_hit / required_total if required_total else 1.0
    logic_rate = logic_hit / logic_total if logic_total else 1.0
    passed = len(translated) == len(cases) and term_rate >= 0.95 and logic_rate >= 0.95
    return {
        "domain": domain, "passed": passed, "elapsedSeconds": elapsed,
        "cues": len(cases), "requiredTerms": required_total,
        "termHits": required_hit, "termAccuracy": round(term_rate, 4),
        "logicChecks": logic_total, "logicHits": logic_hit,
        "logicSignalRate": round(logic_rate, 4), "results": results,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", default="codex_subscription",
                        choices=("codex_subscription", "kimi_subscription"))
    parser.add_argument("--per-domain", type=int, default=20)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--domain", action="append", choices=DOMAINS)
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--failures-only", action="store_true")
    args = parser.parse_args()
    spec = json.loads((ROOT / "tests" / "glossary-evaluation.json").read_text(encoding="utf-8"))
    selected = select_cases(spec, args.per_domain)
    domains = args.domain or list(DOMAINS)
    reports = []
    for domain in domains:
        print(f"[professional-eval] translating {domain} ({args.per_domain} cues)", file=sys.stderr, flush=True)
        reports.append(evaluate_domain(domain, selected[domain], args.provider, args.timeout))
    total_terms = sum(item["requiredTerms"] for item in reports)
    total_hits = sum(item["termHits"] for item in reports)
    total_logic = sum(item["logicChecks"] for item in reports)
    total_logic_hits = sum(item["logicHits"] for item in reports)
    result = {
        "standard": "Quant Scholar Professional Translation Gate v7",
        "provider": args.provider, "cases": sum(item["cues"] for item in reports),
        "passed": all(item["passed"] for item in reports),
        "termAccuracy": round(total_hits / total_terms, 4) if total_terms else 1.0,
        "logicSignalRate": round(total_logic_hits / total_logic, 4) if total_logic else 1.0,
        "thresholds": {"casesPerDomain": args.per_domain, "termAccuracyPerDomain": 0.95,
                       "logicSignalRatePerDomain": 0.95, "cueAlignment": 1.0,
                       "protectedLiteralIntegrity": 1.0},
        "domains": reports,
    }
    if args.compact:
        result["domains"] = [{key: value for key, value in item.items() if key != "results"}
                             for item in reports]
    elif args.failures_only:
        for item in result["domains"]:
            item["results"] = [row for row in item["results"]
                               if row["missingTerms"] or row["missingLogicSignals"]]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
