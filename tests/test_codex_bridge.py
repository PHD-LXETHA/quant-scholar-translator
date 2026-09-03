import subprocess
import unittest
from unittest import mock

from quant_scholar_translator import codex_bridge as MODULE


class CodexBridgeTests(unittest.TestCase):
    @mock.patch.object(MODULE.subprocess, "run")
    def test_status_accepts_chatgpt_login(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, stdout="Logged in using ChatGPT\n", stderr="")
        status = MODULE.codex_status()
        self.assertTrue(status.subscription)
        self.assertEqual(status.billingMode, "chatgpt-subscription")

    @mock.patch.object(MODULE.subprocess, "run")
    def test_status_rejects_api_key_login(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, stdout="Logged in using API key\n", stderr="")
        status = MODULE.codex_status()
        self.assertFalse(status.subscription)
        self.assertEqual(status.billingMode, "api-key")

    @mock.patch.object(MODULE, "codex_status")
    def test_completion_refuses_unknown_billing_mode(self, status):
        status.return_value = MODULE.CodexStatus(True, True, False, "unknown", "unknown")
        with self.assertRaisesRegex(MODULE.CodexBridgeError, "避免意外 API 计费"):
            MODULE.run_codex_completion([{"role": "user", "content": "source"}])


if __name__ == "__main__":
    unittest.main()
