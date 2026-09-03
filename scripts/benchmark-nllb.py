"""Measure cold-start and warm NLLB latency without calling a cloud model."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quant_scholar_translator.realtime import translate


def local_translate(text: str) -> str:
    return translate(text, "en", "zh", provider="nllb", strict=True, offline=True)


samples = [
    "The estimator is asymptotically unbiased under weak dependence.",
    "The portfolio has a Sharpe ratio of 1.42 and maximum drawdown of 8.3%.",
    "A stationary autoregressive process of order one is assumed.",
]

started = time.perf_counter()
local_translate("warm up")
cold_seconds = time.perf_counter() - started

rows = []
for sample in samples:
    started = time.perf_counter()
    output = local_translate(sample)
    rows.append({
        "seconds": round(time.perf_counter() - started, 3),
        "source_chars": len(sample),
        "output": output,
    })

print(json.dumps({
    "cold_seconds": round(cold_seconds, 3),
    "warm_average_seconds": round(sum(row["seconds"] for row in rows) / len(rows), 3),
    "samples": rows,
}, ensure_ascii=False, indent=2))
