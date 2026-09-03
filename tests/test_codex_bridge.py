import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from quant_scholar_translator import codex_bridge as MODULE


class CodexBridgeTests(unittest.TestCase):
    def test_command_finds_versioned_windows_desktop_binary(self):
        with tempfile.TemporaryDirectory() as temp:
            executable = Path(temp) / "OpenAI" / "Codex" / "bin" / "build-id" / "codex.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()
            with (
                mock.patch.object(MODULE.sys, "platform", "win32"),
                mock.patch.object(MODULE.shutil, "which", return_value=None),
                mock.patch.dict(os.environ, {"LOCALAPPDATA": temp}, clear=False),
            ):
                os.environ.pop("QS_CODEX_COMMAND", None)
                os.environ.pop("CODEX_INSTALL_DIR", None)
                self.assertEqual(MODULE._command(), str(executable))

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
