import unittest

from quant_scholar_translator import streaming as MODULE


class StreamingStabilizerTests(unittest.TestCase):
    def test_incremental_merge_removes_boundary_repetition(self):
        self.assertEqual(
            MODULE.merge_incremental_text(
                "the expected return is", "expected return is positive"
            ),
            "the expected return is positive",
        )

    def test_incremental_merge_preserves_new_words(self):
        self.assertEqual(
            MODULE.merge_incremental_text("alpha beta", "gamma delta"),
            "alpha beta gamma delta",
        )

    def test_confirmed_prefix_waits_for_repeated_hypothesis(self):
        buffer = MODULE.ConfirmedPrefixBuffer()
        self.assertEqual(buffer.update("risk premium rises"), ("", "risk premium rises"))
        self.assertEqual(
            buffer.update("risk premium rises quickly"),
            ("risk premium rises", "quickly"),
        )


if __name__ == "__main__":
    unittest.main()
