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
        total = 0
        for domain in ("academic", "finance", "quant_finance", "economics", "statistics", "mathematics", "programming"):
            entries = MODULE.load_glossary(domain)
            total += len(entries)
            self.assertTrue(entries and all(
                isinstance(item.get("source"), str) and item["source"].strip()
                and isinstance(item.get("target"), str) and item["target"].strip()
                and isinstance(item.get("note"), str) and item["note"].strip()
                and all(isinstance(alias, str) and alias.strip() for alias in item.get("aliases", []))
                for item in entries
            ))
        self.assertGreaterEqual(total, 900)

    def test_cross_domain_homonyms_are_disambiguated_before_prompting(self):
        programming = MODULE.relevant_glossary("The function return value has a type annotation.", "programming")
        finance = MODULE.relevant_glossary("Expected return and portfolio volatility.", "finance")
        statistics = MODULE.relevant_glossary("The statistical power of the hypothesis test.", "statistics")
        mathematics = MODULE.relevant_glossary("The matrix power follows from the eigenvalue.", "mathematics")

        self.assertIn(("return", "返回"), {(item["source"], item["target"]) for item in programming})
        self.assertNotIn(("return", "收益率"), {(item["source"], item["target"]) for item in programming})
        self.assertIn(("return", "收益率"), {(item["source"], item["target"]) for item in finance})
        self.assertIn(("power", "检验功效"), {(item["source"], item["target"]) for item in statistics})
        self.assertIn(("power", "幂"), {(item["source"], item["target"]) for item in mathematics})

    def test_bare_ambiguous_term_does_not_inject_contradictory_hints(self):
        for text, conflicting_sources in (
            ("return", {"return"}),
            ("CI", {"confidence interval", "continuous integration"}),
            ("generator", {"infinitesimal generator", "generator"}),
        ):
            entries = MODULE.relevant_glossary(text, "auto")
            self.assertEqual([item for item in entries if item["source"].lower() in conflicting_sources], [])

    def test_alias_conflicts_use_context_without_sending_both_meanings(self):
        programming = MODULE.relevant_glossary("CI pipeline and package manager", "auto")
        statistics = MODULE.relevant_glossary("95% CI for an unbiased estimator", "auto")
        math = MODULE.relevant_glossary("infinitesimal generator of a Markov process", "auto")
        self.assertIn("持续集成", {item["target"] for item in programming})
        self.assertNotIn("置信区间", {item["target"] for item in programming})
        self.assertIn("置信区间", {item["target"] for item in statistics})
        self.assertNotIn("持续集成", {item["target"] for item in statistics})
        self.assertIn("无穷小生成元", {item["target"] for item in math})
        self.assertNotIn("生成器", {item["target"] for item in math})

    def test_generic_professional_sense_requires_context_in_auto_mode(self):
        ordinary = MODULE.relevant_glossary("The video duration is ten minutes.", "auto")
        finance = MODULE.relevant_glossary("Bond duration and convexity measure rate sensitivity.", "auto")
        explicit = MODULE.relevant_glossary("duration", "finance")
        self.assertNotIn("久期", {item["target"] for item in ordinary})
        self.assertIn("久期", {item["target"] for item in finance})
        self.assertIn("久期", {item["target"] for item in explicit})

    def test_new_professional_coverage_spans_all_learning_domains(self):
        cases = {
            "academic": ("causal inference", "因果推断"),
            "economics": ("Taylor rule", "泰勒规则"),
            "finance": ("net present value", "净现值"),
            "quant_finance": ("non-modellable risk factor", "不可建模风险因子"),
            "statistics": ("heteroskedasticity-consistent standard error", "异方差稳健标准误"),
            "mathematics": ("infinitesimal generator", "无穷小生成元"),
            "programming": ("abstract syntax tree", "抽象语法树"),
        }
        for domain, (source, target) in cases.items():
            entries = MODULE.relevant_glossary(source, domain)
            self.assertIn((source, target), {(item["source"], item["target"]) for item in entries})

    def test_contextual_retrieval_includes_cqf_math_even_in_quant_domain(self):
        entries = MODULE.relevant_glossary("Ito’s lemma and quadratic variation under a risk neutral measure; VaR and ES versus EL.", "quant_finance")
        prompt = MODULE.glossary_prompt(entries)
        for term in ("伊藤引理", "二次变差", "风险中性测度", "风险价值", "预期信用损失"):
            self.assertIn(term, prompt)
        self.assertIn("不等同于信用风险", prompt)
        self.assertNotIn("garbage collection", prompt)

    def test_retrieval_uses_word_boundaries_and_respects_limit(self):
        self.assertEqual(MODULE.relevant_glossary("alphabetagamma classification", "programming"), [])
        entries = MODULE.load_glossary("mathematics")
        text = " ".join(item['source'] for item in entries)
        self.assertEqual(len(MODULE.select_glossary(entries, text, 5)), 5)

    @mock.patch.object(MODULE, "run_codex_completion", return_value='{"cues":[{"id":"paragraph","text":"利用二次变差。"}],"review":[]}')
    def test_professional_translation_actually_receives_relevant_glossary(self, run):
        MODULE.translate_codex_subscription("Use quadratic variation.", "en", "zh", "quant_finance")
        prompt = run.call_args.args[0][0]['content']
        self.assertIn("二次变差", prompt)
        self.assertNotIn("garbage collection", prompt)

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
