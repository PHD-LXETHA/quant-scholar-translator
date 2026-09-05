import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "evaluate-professional-translation.py"
SPEC = importlib.util.spec_from_file_location("professional_translation_evaluation", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ProfessionalTranslationEvaluationTests(unittest.TestCase):
    def test_normalization_tolerates_typographic_spacing(self):
        self.assertEqual(MODULE.normalized("杜布–迈耶 分解"), MODULE.normalized("杜布-迈耶分解"))

    def test_logic_expectations_cover_negation_contrast_and_condition(self):
        labels = [label for label, _ in MODULE.logic_expectations(
            "Unlike A, B does not hold if x = 0.")]
        self.assertEqual(labels, ["negation", "contrast", "condition"])

    def test_approved_target_variants_are_loaded(self):
        variants = MODULE.target_variants_by_domain()
        self.assertIn("通胀", variants["economics"]["通货膨胀"])

    def test_select_cases_requires_twenty_per_domain(self):
        import json
        spec = json.loads((SCRIPT.parents[1] / "tests" / "glossary-evaluation.json").read_text(encoding="utf-8"))
        selected = MODULE.select_cases(spec, 20)
        self.assertEqual(set(selected), set(MODULE.DOMAINS))
        self.assertTrue(all(len(items) == 20 for items in selected.values()))


if __name__ == "__main__":
    unittest.main()
