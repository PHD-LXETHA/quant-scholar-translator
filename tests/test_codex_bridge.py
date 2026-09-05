import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from quant_scholar_translator import codex_bridge as MODULE


class CodexBridgeTests(unittest.TestCase):
    @mock.patch.dict(MODULE.os.environ, {
        "USERPROFILE": r"C:\Users\reader",
        "OPENAI_API_KEY": "must-not-leak",
        "CODEX_API_KEY": "must-not-leak",
    }, clear=True)
    def test_clean_environment_pins_persistent_codex_home(self):
        env = MODULE._clean_environment()
        self.assertEqual(env["CODEX_HOME"], r"C:\Users\reader\.codex")
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("CODEX_API_KEY", env)

    @mock.patch.dict(MODULE.os.environ, {
        "USERPROFILE": r"C:\Users\reader",
        "CODEX_HOME": r"D:\CodexProfile",
    }, clear=True)
    def test_clean_environment_preserves_explicit_codex_home(self):
        self.assertEqual(MODULE._clean_environment()["CODEX_HOME"], r"D:\CodexProfile")

    @mock.patch.object(MODULE, "codex_status")
    @mock.patch.object(MODULE.subprocess, "run")
    def test_pins_sol_and_medium_or_high_without_changing_billing(self, run, status):
        status.return_value = MODULE.CodexStatus(True, True, True, "chatgpt-subscription", "ok")
        run.return_value = subprocess.CompletedProcess([], 0, stdout="译文", stderr="")
        for effort in ("medium", "high"):
            with self.subTest(effort=effort), mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "CODEX_API_KEY": "secret"}):
                kwargs = {} if effort == "medium" else {"reasoning_effort": effort}
                self.assertEqual(MODULE.run_codex_completion([{"role": "user", "content": "Translate."}], **kwargs), "译文")
                args = run.call_args.args[0]
                self.assertEqual(args[args.index("--model") + 1], "gpt-5.6-sol")
                self.assertIn(f'model_reasoning_effort="{effort}"', args)
                self.assertIn("--ignore-user-config", args)
                self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
                self.assertNotIn("OPENAI_API_KEY", run.call_args.kwargs["env"])
                self.assertNotIn("CODEX_API_KEY", run.call_args.kwargs["env"])
        self.assertEqual(status.return_value.to_dict()["configuredModel"], "gpt-5.6-sol")

    @mock.patch.object(MODULE.subprocess, "run")
    def test_invalid_reasoning_is_rejected_before_cli(self, run):
        with self.assertRaises(ValueError):
            MODULE.run_codex_completion([], reasoning_effort="ultra")
        run.assert_not_called()

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

    @mock.patch.object(MODULE.shutil, "which", return_value=r"C:\stable\codex.exe")
    def test_command_prefers_stable_path_command_across_desktop_updates(self, _which):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QS_CODEX_COMMAND", None)
            self.assertEqual(MODULE._command(), r"C:\stable\codex.exe")

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

    @mock.patch.object(MODULE.subprocess, "run")
    def test_status_check_never_starts_interactive_login(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, stdout="Not logged in\n", stderr="")
        MODULE.codex_status()
        command = run.call_args.args[0]
        self.assertEqual(command[1:], ["login", "status"])

    @mock.patch.object(MODULE, "codex_status")
    def test_completion_refuses_unknown_billing_mode(self, status):
        status.return_value = MODULE.CodexStatus(True, True, False, "unknown", "unknown")
        with self.assertRaisesRegex(MODULE.CodexBridgeError, "避免意外 API 计费"):
            MODULE.run_codex_completion([{"role": "user", "content": "source"}])


if __name__ == "__main__":
    unittest.main()
