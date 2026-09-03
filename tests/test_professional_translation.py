import unittest
from unittest import mock

from quant_scholar_translator import translation as MODULE


class ProfessionalTranslationTests(unittest.TestCase):
    def test_domain_detection_distinguishes_programming_and_quant_finance(self):
        self.assertEqual(MODULE.detect_domain("The function return value is handled by the runtime"), "programming")
        self.assertEqual(MODULE.detect_domain("Factor exposure and maximum drawdown in a portfolio backtest"), "quant_finance")

    def test_formula_code_url_and_citations_round_trip(self):
        source = "Estimate $E[R_t]=alpha+beta*x_t$ with `statsmodels.OLS()`; see [12] https://example.com."
        protected = MODULE.protect(source)
        self.assertNotIn("$E[R_t]", protected.text)
        self.assertNotIn("`statsmodels.OLS()`", protected.text)
        self.assertEqual(MODULE.restore(protected.text, protected.values), source)

    def test_numbers_formulas_and_code_cannot_disappear_from_a_final_translation(self):
        protected = MODULE.protect("Sharpe rose from 1.2 to 1.8; evaluate $E[R_t]$ with `fit()`.")
        self.assertGreaterEqual(len(protected.values), 4)
        with self.assertRaises(ValueError):
            MODULE.restore_checked("夏普比率有所上升。", protected.values)

    def test_professional_context_is_separate_from_the_text_to_translate(self):
        prompt = MODULE.contextual_user_text("power increased", "The hypothesis test rejected H0.")
        self.assertIn("Previous source context", prompt)
        self.assertIn("Text to translate:\npower increased", prompt)

    def test_placeholder_indexes_do_not_collide(self):
        values = [str(index * 11) for index in range(12)]
        self.assertEqual(MODULE.restore("QS_PROTECTED_1 QS_PROTECTED_10", values), "11 110")

    def test_indefinite_article_is_not_mistaken_for_an_acronym(self):
        self.assertEqual(MODULE.protect("A stationary process").text, "A stationary process")

    def test_every_domain_glossary_loads(self):
        for domain in ("academic", "finance", "quant_finance", "economics", "statistics", "mathematics", "programming"):
            entries = MODULE.load_glossary(domain)
            self.assertTrue(entries and all("source" in item and "target" in item for item in entries))

    def test_hotwords_are_domain_specific_and_auto_combines_domains(self):
        quant = MODULE.hotwords_for_domain("quant_finance")
        combined = MODULE.hotwords_for_domain("auto")
        self.assertIn("maximum drawdown", quant)
        self.assertIn("maximum drawdown", combined)
        self.assertIn("runtime", combined)

    @mock.patch.object(MODULE, "run_kimi_completion", return_value="收益率为 $r_t$。")
    def test_kimi_subscription_translation_preserves_formula(self, _run):
        output = MODULE.translate_kimi_subscription("Return is $r_t$.", "en", "zh", "finance")
        self.assertEqual(output, "收益率为 $r_t$。")


if __name__ == "__main__":
    unittest.main()
