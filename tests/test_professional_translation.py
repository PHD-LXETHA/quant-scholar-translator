import unittest

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


if __name__ == "__main__":
    unittest.main()
