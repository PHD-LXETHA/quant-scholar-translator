import json
import unittest
from unittest.mock import patch

from quant_scholar_translator.caption_translation import translate_cues


class CaptionTranslationTests(unittest.TestCase):
    def call(self, output, provider="codex_subscription"):
        with patch("quant_scholar_translator.caption_translation.run_codex_completion", return_value=output) as codex, patch("quant_scholar_translator.caption_translation.run_kimi_completion", return_value=output) as kimi:
            result = translate_cues([{"id": "a", "text": "GDP is 3%."}, {"id": "b", "text": "Risk."}], "en", "zh", "economics", provider, "Previous original context.")
            return result, codex, kimi

    def test_per_cue_restore_and_reordered_response(self):
        result, codex, _ = self.call(json.dumps({"cues": [{"id": "b", "text": "风险。"}, {"id": "a", "text": "国内生产总值（⟪QS_PROTECTED_0⟫）为 ⟪QS_PROTECTED_1⟫。"}], "review": []}))
        self.assertEqual(result, [{"id": "a", "text": "国内生产总值（GDP）为 3%。"}, {"id": "b", "text": "风险。"}])
        messages = codex.call_args.args[0]
        self.assertIn("Read ALL cues", messages[0]["content"])
        self.assertIn("Previous original context", messages[1]["content"])
        payload = json.loads(messages[1]["content"])
        self.assertEqual(payload["cues"][0]["protectedTokens"], {
            "⟪QS_PROTECTED_0⟫": "GDP", "⟪QS_PROTECTED_1⟫": "3%",
        })

    def test_kimi_uses_same_contract(self):
        _, codex, kimi = self.call('{"cues":[{"id":"a","text":"国内生产总值（GDP）为 3%。"},{"id":"b","text":"风险。"}]}', "kimi_subscription")
        codex.assert_not_called()
        kimi.assert_called_once()

    def test_kimi_corrects_missing_required_terminology_once(self):
        outputs = [
            '{"cues":[{"id":"a","text":"GDP 为 3%。"},{"id":"b","text":"风险。"}]}',
            '{"cues":[{"id":"a","text":"国内生产总值（⟪QS_PROTECTED_0⟫）为 ⟪QS_PROTECTED_1⟫。"}]}',
        ]
        with patch("quant_scholar_translator.caption_translation.run_kimi_completion", side_effect=outputs) as kimi:
            result = translate_cues(
                [{"id": "a", "text": "GDP is 3%."}, {"id": "b", "text": "Risk."}],
                "en", "zh", "economics", "kimi_subscription",
            )
        self.assertEqual(result[0]["text"], "国内生产总值（GDP）为 3%。")
        self.assertEqual(result[1]["text"], "风险。")
        self.assertEqual(kimi.call_count, 2)

    def test_omissions_wrong_ids_duplicates_empty_and_lost_numbers_rejected(self):
        bad = ["not JSON", '{"cues":[]}',
               '{"cues":[{"id":"a","text":"GDP 3%"},{"id":"a","text":"风险"}]}',
               '{"cues":[{"id":"a","text":"GDP 3%"},{"id":"x","text":"风险"}]}',
               '{"cues":[{"id":"a","text":"GDP"},{"id":"b","text":"风险"}]}',
               '{"cues":[{"id":"a","text":"GDP 3%"},{"id":"b","text":""}]}',
               '{"cues":[{"id":"a","text":"GDP 3%"},{"id":"b","text":"⟪QS_PROTECTED_0⟫"}]}']
        for output in bad:
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.call(output)

    def test_unsupported_engine_does_not_silently_fallback(self):
        with self.assertRaises(ValueError):
            self.call('{}', 'nllb')

    def test_endpoint_validation_and_response(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        client = TestClient(app)
        request = {"cues": [{"id": "a", "text": "Risk."}], "translator": "kimi_subscription"}
        with patch("quant_scholar_translator.caption_translation.run_kimi_completion", return_value='{"cues":[{"id":"a","text":"风险。"}]}'):
            response = client.post('/translate/cues', json=request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['cues'][0]['text'], '风险。')
        request['cues'] *= 2
        self.assertEqual(client.post('/translate/cues', json=request).status_code, 422)


if __name__ == '__main__':
    unittest.main()
