import json
import threading
import unittest
from unittest import mock

from quant_scholar_translator import nllb_glossary as terms
from quant_scholar_translator import realtime
from quant_scholar_translator.translation import protect


class NllbGlossaryTests(unittest.TestCase):
    def setUp(self):
        self.event = mock.patch.object(realtime, '_nllb_glossary_disabled', threading.Event())
        self.event.start()
        self.addCleanup(self.event.stop)
        env = mock.patch.dict('os.environ', {'QS_NLLB_GLOSSARY': 'on'})
        env.start()
        self.addCleanup(env.stop)

    def test_reviewed_allowlist_covers_seven_domains_and_uses_maintained_targets(self):
        allowlist = json.loads(terms.ALLOWLIST_PATH.read_text(encoding='utf-8'))
        self.assertEqual(len(allowlist), 7)
        for domain, sources in allowlist.items():
            entries = json.loads((terms.GLOSSARY_DIR / f'{domain}.json').read_text(encoding='utf-8'))
            by_source = {entry['source']: entry for entry in entries}
            for source in sources:
                with self.subTest(source=source):
                    self.assertIn(source, by_source)
                    prepared = terms.protect_terms(protect(source), 'en', 'zh')
                    self.assertIn(by_source[source]['target'], prepared.values)

    def test_code_math_numbers_and_acronyms_are_not_rewritten_as_terms(self):
        base = protect('Use `maximum drawdown` and $confidence interval$ at 2.5% with CI; compare quadratic variation.')
        prepared = terms.protect_terms(base, 'en', 'zh')
        self.assertEqual(prepared.values[:len(base.values)], base.values)
        self.assertEqual(prepared.values[len(base.values):], ['二次变差'])
        restored = terms.restore_terms(prepared.text, prepared, len(base.values))
        self.assertIn('`maximum drawdown`', restored)
        self.assertIn('$confidence interval$', restored)
        self.assertIn('2.5%', restored)
        self.assertIn('CI', restored)

    def test_languages_homonyms_word_boundaries_and_longer_concepts_are_skipped(self):
        for source, lang, target in [('maximum drawdown', 'en', 'fr'), ('maximum drawdown', 'auto', 'zh'), ('duration return power', 'en', 'zh'), ('garbage collections', 'en', 'zh'), ('bootstrap confidence interval', 'en', 'zh'), ('stochastic gradient descent', 'en', 'zh')]:
            base = protect(source)
            self.assertIs(terms.protect_terms(base, lang, target), base)

    def test_occurrences_are_bounded_and_each_has_a_unique_marker(self):
        base = protect(' '.join(['quadratic variation'] * 8))
        prepared = terms.protect_terms(base, 'en', 'zh')
        self.assertEqual(len(prepared.values), terms.MAX_TERM_OCCURRENCES)
        self.assertEqual(prepared.text.count('quadratic variation'), 4)
        self.assertEqual(terms.restore_terms(prepared.text, prepared, 0).count('二次变差'), 4)

    def test_cache_is_reused_without_filesystem_reads(self):
        terms._index()
        with mock.patch.object(terms.Path, 'read_text', side_effect=AssertionError('unexpected read')):
            self.assertIn('二次变差', terms.protect_terms(protect('quadratic variation'), 'en', 'zh').values)

    def test_corrupt_marker_falls_back_once_then_bypasses_terms(self):
        for corrupt in ['译文缺标记', 'QS_PROTECTED_0 QS_PROTECTED_0', 'QS_PROTECTED_99']:
            realtime._nllb_glossary_disabled.clear()
            with mock.patch.object(realtime, '_translate_nllb', side_effect=[corrupt, '正常快译', '下一次快译']) as translate:
                self.assertEqual(realtime.translate('quadratic variation', 'en', 'zh', provider='nllb', strict=True, offline=True), '正常快译')
                self.assertEqual(realtime.translate('quadratic variation', 'en', 'zh', provider='nllb', strict=True, offline=True), '下一次快译')
                self.assertEqual(translate.call_count, 3)
                self.assertIn('QS_PROTECTED', translate.call_args_list[0].args[0])
                self.assertEqual(translate.call_args_list[1].args[0], 'quadratic variation')
                self.assertEqual(translate.call_args_list[2].args[0], 'quadratic variation')
                self.assertTrue(all(not call.kwargs['allow_network_fallback'] for call in translate.call_args_list))

    def test_success_uses_one_inference_and_can_be_disabled(self):
        with mock.patch.object(realtime, '_translate_nllb', return_value='比较 QS_PROTECTED_0。') as translate:
            result = realtime.translate('Compare quadratic variation.', 'en', 'zh', provider='nllb', strict=True, offline=True)
            self.assertEqual(result, '比较 二次变差。')
            self.assertEqual(translate.call_count, 1)
        with mock.patch.dict('os.environ', {'QS_NLLB_GLOSSARY': 'off'}), mock.patch.object(realtime, '_translate_nllb', return_value='原有快译') as translate:
            self.assertEqual(realtime.translate('quadratic variation', 'en', 'zh', provider='nllb', strict=True, offline=True), '原有快译')
            self.assertEqual(translate.call_args.args[0], 'quadratic variation')
