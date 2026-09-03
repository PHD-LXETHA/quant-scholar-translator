import json
import unittest
from pathlib import Path

from quant_scholar_translator import pdf as MODULE


class PdfAdapterTests(unittest.TestCase):
    def test_command_is_an_argv_array_and_expands_known_placeholders(self):
        template = json.dumps([
            "pdf-engine", "--input", "{input}", "--output", "{output_dir}",
            "--source", "{source_lang}", "--target", "{target_lang}"
        ])
        command = MODULE.command_from_template(
            template,
            input_pdf=Path("paper.pdf"),
            output_dir=Path("translated"),
            source_lang="en",
            target_lang="zh",
        )
        self.assertEqual(command[0], "pdf-engine")
        self.assertEqual(command[-1], "zh")
        self.assertIn("paper.pdf", command)

    def test_shell_command_string_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.command_from_template(
                json.dumps("pdf-engine paper.pdf"),
                input_pdf=Path("paper.pdf"),
                output_dir=Path("translated"),
                source_lang="en",
                target_lang="zh",
            )

    def test_manifest_command_redacts_common_secret_flags(self):
        command = ["pdf-engine", "--openai-api-key", "very-secret", "--target", "zh"]
        self.assertEqual(MODULE.redact_command(command)[2], "***")
        self.assertEqual(command[2], "very-secret")

    def test_default_template_invokes_the_bundled_engine(self):
        command = json.loads(MODULE.bundled_command_template())
        self.assertEqual(command[1:3], ["-m", "babeldoc.main"])
        self.assertIn("--files", command)
        self.assertIn("--lang-out", command)


if __name__ == "__main__":
    unittest.main()
