"""Local, offline-only A/B check; prints timing and example outputs as JSON."""
import argparse
import json
import os
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.stdout.reconfigure(encoding='utf-8')
from quant_scholar_translator import realtime as engine
from quant_scholar_translator.nllb_glossary import protect_terms
from quant_scholar_translator.translation import protect

SAMPLES = [
    ('mathematics', 'Use quadratic variation in the stochastic differential equation.'),
    ('statistics', 'Maximum likelihood estimation gives a confidence interval.'),
    ('quant_finance', 'Compare maximum drawdown under the risk-neutral measure.'),
    ('finance', 'Compare net present value with internal rate of return.'),
    ('economics', 'The consumer price index differs from gross domestic product.'),
    ('programming', 'The return value depends on garbage collection.'),
    ('academic', 'The systematic review discusses publication bias and peer review.'),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rounds', type=int, default=3)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error('--rounds must be positive')
    old = os.environ.get('QS_NLLB_GLOSSARY')
    measurements = {'off': [], 'on': []}
    examples = []
    try:
        start = time.perf_counter()
        if engine._get_nllb(allow_download=False) is None:
            raise RuntimeError('Install the local NLLB checkpoint before benchmarking')
        model_load_ms = (time.perf_counter() - start) * 1000
        base = protect(SAMPLES[0][1])
        start = time.perf_counter()
        protect_terms(base, 'en', 'zh')
        index_build_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        for _ in range(1000):
            protect_terms(base, 'en', 'zh')
        lookup_ms = (time.perf_counter() - start)
        # Model warm-up is excluded. Alternate ordering to reduce timing bias.
        engine._translate_nllb('The example is useful.', 'en', 'zh', allow_network_fallback=False)
        for iteration in range(args.rounds):
            for domain, source in SAMPLES:
                outputs = {}
                for mode in (('off', 'on') if iteration % 2 == 0 else ('on', 'off')):
                    os.environ['QS_NLLB_GLOSSARY'] = mode
                    start = time.perf_counter()
                    outputs[mode] = engine.translate(source, 'en', 'zh', domain, 'nllb', strict=True, offline=True)
                    measurements[mode].append((time.perf_counter() - start) * 1000)
                if iteration == 0:
                    examples.append({'domain': domain, 'source': source, **outputs})
        result = {
            'rounds': args.rounds, 'sentences_per_mode': len(measurements['on']),
            'model_load_ms': round(model_load_ms, 2), 'index_build_ms': round(index_build_ms, 2),
            'cached_lookup_ms': round(lookup_ms, 4),
            'timings_ms': {mode: {'mean': round(statistics.mean(values), 2), 'median': round(statistics.median(values), 2)} for mode, values in measurements.items()},
            'terminology_disabled_after_marker_failure': engine._nllb_glossary_disabled.is_set(),
            'examples': examples,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        if old is None:
            os.environ.pop('QS_NLLB_GLOSSARY', None)
        else:
            os.environ['QS_NLLB_GLOSSARY'] = old


if __name__ == '__main__':
    main()
