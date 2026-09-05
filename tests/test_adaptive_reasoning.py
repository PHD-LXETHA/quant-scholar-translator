import json
import unittest
from unittest.mock import patch

from quant_scholar_translator.caption_translation import translate_cues
from quant_scholar_translator.translation import translate_codex_subscription


def response(rows, review=None):
    return json.dumps({"cues": [{"id": key, "text": text} for key, text in rows], "review": review or []})


class AdaptiveReasoningTests(unittest.TestCase):
    cues = [{"id": "a", "text": "Risk is priced."}, {"id": "b", "text": "It follows under this measure."}]

    def translate(self):
        return translate_cues(self.cues, "en", "zh", "quant_finance", "codex_subscription", "Original surrounding context")

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_clear_paragraph_uses_medium_only(self, run):
        run.return_value = response([("a", "风险被定价。"), ("b", "在该测度下可以得出这一结论。")])
        self.assertEqual(len(self.translate()), 2)
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs["reasoning_effort"], "medium")

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_only_doubtful_cues_are_retranslated_from_original(self, run):
        run.side_effect = [response([("a", "风险被定价。"), ("b", "初译不可作为复译依据")],
                                    [{"id": "b", "reason": "reference"}]),
                           response([("b", "在此测度下，这一结论成立。")])]
        result = self.translate()
        self.assertEqual(result, [{"id": "a", "text": "风险被定价。"}, {"id": "b", "text": "在此测度下，这一结论成立。"}])
        self.assertEqual([call.kwargs["reasoning_effort"] for call in run.call_args_list], ["medium", "high"])
        prompt = run.call_args.args[0][1]["content"]
        payload = json.loads(prompt)
        self.assertNotIn("初译", prompt)
        self.assertEqual(payload["paragraphSource"], self.cues)
        self.assertEqual([cue["id"] for cue in payload["cues"]], ["b"])

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_strict_glossary_mismatch_triggers_high_review(self, run):
        run.side_effect = [response([("n", "临近预测使用当前指标。")]),
                           response([("n", "即时预测使用当前指标。")])]
        result = translate_cues([{"id": "n", "text": "Nowcasting uses current indicators."}],
                                "en", "zh", "economics", "codex_subscription")
        self.assertEqual(result[0]["text"], "即时预测使用当前指标。")
        self.assertEqual([call.kwargs["reasoning_effort"] for call in run.call_args_list], ["medium", "high"])
        payload = json.loads(run.call_args.args[0][1]["content"])
        self.assertEqual(payload["requiredTerminology"]["n"][0]["requiredTarget"], "即时预测")

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_unresolved_strict_glossary_mismatch_is_rejected(self, run):
        run.side_effect = [response([("n", "临近预测。")]), response([("n", "临近预测。")])]
        with self.assertRaisesRegex(ValueError, "强制专业术语"):
            translate_cues([{"id": "n", "text": "Nowcasting."}],
                           "en", "zh", "economics", "codex_subscription")

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_high_review_is_chunked_to_keep_alignment_reliable(self, run):
        cues = [{"id": str(index), "text": "Nowcasting."} for index in range(6)]
        run.side_effect = [
            response([(cue["id"], "临近预测。") for cue in cues]),
            response([(cue["id"], "即时预测。") for cue in cues[:5]]),
            response([(cues[5]["id"], "即时预测。")]),
        ]
        result = translate_cues(cues, "en", "zh", "economics", "codex_subscription")
        self.assertEqual(len(result), 6)
        self.assertEqual(run.call_count, 3)
        high_payload_sizes = [len(json.loads(call.args[0][1]["content"])["cues"])
                              for call in run.call_args_list[1:]]
        self.assertEqual(high_payload_sizes, [5, 1])

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_broken_alignment_gets_one_high_retry(self, run):
        run.side_effect = ["not JSON", response([("b", "结论。"), ("a", "风险。")])]
        self.assertEqual([row["id"] for row in self.translate()], ["a", "b"])
        self.assertEqual(run.call_count, 2)

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_high_cannot_drop_numbers_or_loop(self, run):
        run.side_effect = ["not JSON", response([("n", "收益率。")])]
        with self.assertRaises(ValueError):
            translate_cues([{"id": "n", "text": "Return is 3%."}], "en", "zh", "finance", "codex_subscription")
        self.assertEqual(run.call_count, 2)

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_unresolved_high_doubt_is_not_silently_finalized(self, run):
        run.return_value = response([("a", "风险。"), ("b", "结论。")], [{"id": "a", "reason": "source_ambiguity"}, {"id": "b", "reason": "reference"}])
        with self.assertRaisesRegex(ValueError, "高等复译后仍有"):
            self.translate()
        self.assertEqual(run.call_count, 2)

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_service_failure_does_not_trigger_an_extra_model_call(self, run):
        run.side_effect = RuntimeError("service offline")
        with self.assertRaises(RuntimeError):
            self.translate()
        run.assert_called_once()

    @patch("quant_scholar_translator.translation.run_codex_completion")
    def test_plain_text_paragraph_uses_same_policy_and_returns_plain_text(self, run):
        run.side_effect = [response([("paragraph", "草稿")], [{"id": "paragraph", "reason": "terminology"}]),
                           response([("paragraph", "该测度是等价的。")])]
        self.assertEqual(translate_codex_subscription("The measure is equivalent.", "en", "zh", "mathematics", timeout=120), "该测度是等价的。")
        self.assertEqual(run.call_args.kwargs, {"reasoning_effort": "high", "timeout": 120})

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_missing_review_assessment_is_not_assumed_clear(self, run):
        run.side_effect = [json.dumps({"cues": [{"id": "a", "text": "风险。"}, {"id": "b", "text": "结论。"}]}),
                           response([("a", "风险。"), ("b", "结论。")])]
        self.translate()
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.kwargs["reasoning_effort"], "high")

    @patch("quant_scholar_translator.caption_translation.run_codex_completion")
    def test_invalid_review_ids_cannot_inject_extra_targets(self, run):
        run.side_effect = [response([("a", "风险。"), ("b", "结论。")], [{"id": "unknown", "reason": "reference"}]),
                           response([("a", "风险。"), ("b", "结论。")])]
        self.translate()
        self.assertEqual([row["id"] for row in json.loads(run.call_args.args[0][1]["content"])["cues"]], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
