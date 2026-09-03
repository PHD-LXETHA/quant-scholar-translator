import unittest
import tempfile
from pathlib import Path
from unittest import mock

from quant_scholar_translator import realtime as MODULE


class TranslationModeTests(unittest.TestCase):
    def test_professional_is_the_safe_default(self):
        self.assertEqual(MODULE.normalize_translation_mode(None), "professional")
        self.assertEqual(MODULE.normalize_translation_mode("unexpected"), "professional")
        self.assertEqual(MODULE.normalize_translation_mode("quick"), "quick")

    def test_preview_provider_never_becomes_the_professional_provider(self):
        self.assertEqual(MODULE.professional_provider("nllb"), "kimi_subscription")
        self.assertEqual(MODULE.professional_provider("codex"), "codex")

    @mock.patch.object(MODULE, "_translate_google")
    @mock.patch.object(MODULE, "_get_nllb", return_value=None)
    def test_offline_nllb_never_uses_google_fallback(self, _get_nllb, google):
        with self.assertRaises(RuntimeError):
            MODULE.translate("risk premium", "en", "zh", provider="nllb", strict=True, offline=True)
        google.assert_not_called()

    @mock.patch.object(
        MODULE,
        "_translate_nllb",
        return_value="Sharpe 比率为 QS_PROTECTED_0，最大回撤为 QS_PROTECTED_1。",
    )
    def test_nllb_restores_numbers_and_units_after_tokenizer_strips_brackets(self, nllb):
        result = MODULE.translate(
            "Sharpe ratio is 1.42 and maximum drawdown is 8.3%.",
            "en",
            "zh",
            provider="nllb",
            strict=True,
            offline=True,
        )
        self.assertIn("1.42", result)
        self.assertIn("8.3%", result)
        self.assertNotIn("QS_PROTECTED", result)
        self.assertIn("⟪QS_PROTECTED_0⟫", nllb.call_args.args[0])

    def test_unknown_provider_fails_in_strict_mode(self):
        with self.assertRaises(ValueError):
            MODULE.translate("alpha", "en", "zh", provider="mystery", strict=True)

    def test_mobile_pairing_token_uses_constant_time_match(self):
        with mock.patch.object(MODULE, "MOBILE_ACCESS_TOKEN", "paired-secret"):
            self.assertTrue(MODULE._mobile_token_valid("paired-secret"))
            self.assertFalse(MODULE._mobile_token_valid("wrong"))
        with mock.patch.object(MODULE, "MOBILE_ACCESS_TOKEN", ""):
            self.assertFalse(MODULE._mobile_token_valid("paired-secret"))

    def test_mobile_workspace_is_packaged(self):
        self.assertTrue((MODULE.MOBILE_ROOT / "index.html").is_file())
        self.assertTrue((MODULE.MOBILE_ROOT / "app.js").is_file())

    def test_offline_missing_model_does_not_attempt_download(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(MODULE, "NLLB_CT2_CACHE", Path(directory)):
                with mock.patch.object(MODULE, "_nllb", None), mock.patch.object(MODULE, "_nllb_failed", False):
                    self.assertIsNone(MODULE._get_nllb(allow_download=False))

    @mock.patch.object(MODULE, "_translate_google")
    @mock.patch.object(MODULE, "_get_nllb", return_value=(mock.Mock(), mock.Mock()))
    def test_offline_unsupported_target_does_not_use_online_fallback(self, _get_nllb, google):
        with self.assertRaises(ValueError):
            MODULE._translate_nllb("risk", "en", "unsupported", allow_network_fallback=False)
        google.assert_not_called()


if __name__ == "__main__":
    unittest.main()
