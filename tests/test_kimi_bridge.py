import os
import subprocess
import unittest
from unittest import mock

from quant_scholar_translator import kimi_bridge as MODULE


class KimiBridgeTests(unittest.TestCase):
    @mock.patch.object(MODULE.subprocess, "run")
    def test_status_accepts_only_managed_oauth_provider(self, run):
        run.return_value = subprocess.CompletedProcess(
            [], 0,
            stdout="managed:kimi-code  type=kimi  models=4  source=oauth\n",
            stderr="",
        )
        status = MODULE.kimi_status()
        self.assertTrue(status.available)
        self.assertTrue(status.subscription)
        self.assertEqual(status.billingMode, "kimi-subscription")

    @mock.patch.object(MODULE.subprocess, "run")
    def test_status_rejects_non_oauth_provider(self, run):
        run.return_value = subprocess.CompletedProcess(
            [], 0,
            stdout="custom-provider  type=openai-compatible  models=1  source=config\n",
            stderr="",
        )
        status = MODULE.kimi_status()
        self.assertFalse(status.subscription)

    @mock.patch.object(MODULE, "kimi_status")
    @mock.patch.object(MODULE.subprocess, "run")
    def test_completion_isolated_and_drops_api_keys(self, run, status):
        status.return_value = MODULE.KimiStatus(True, True, True, "kimi-subscription", "oauth")
        run.return_value = subprocess.CompletedProcess([], 0, stdout="专业译文\n", stderr="")
        with mock.patch.dict(os.environ, {"KIMI_API_KEY": "secret", "MOONSHOT_API_KEY": "secret"}):
            output = MODULE.run_kimi_completion([{"role": "user", "content": "source"}])
        self.assertEqual(output, "专业译文")
        command = run.call_args.args[0]
        kwargs = run.call_args.kwargs
        self.assertNotIn("--plan", command)
        self.assertIn("--agent-file", command)
        self.assertIn("--skills-dir", command)
        self.assertNotIn("--yolo", command)
        self.assertIn("tools: []", MODULE._TRANSLATOR_AGENT)
        self.assertNotIn("KIMI_API_KEY", kwargs["env"])
        self.assertNotIn("MOONSHOT_API_KEY", kwargs["env"])


if __name__ == "__main__":
    unittest.main()
