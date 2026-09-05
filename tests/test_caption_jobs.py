import threading
import time
import unittest
from unittest.mock import patch

from quant_scholar_translator.caption_jobs import CaptionJobs


class CaptionJobTests(unittest.TestCase):
    def test_slow_job_returns_immediately_and_duplicate_requests_run_once(self):
        release = threading.Event()
        calls = []
        def run(payload):
            calls.append(payload)
            release.wait(2)
            return [{'id': 'a', 'text': '译文'}]
        jobs = CaptionJobs(run)
        try:
            started = time.monotonic()
            self.assertEqual(jobs.submit('same', {'text': 'source'})['status'], 'running')
            self.assertLess(time.monotonic() - started, 0.5)
            for _ in range(10):
                self.assertEqual(jobs.submit('same', {'text': 'source'})['status'], 'running')
            with self.assertRaises(ValueError):
                jobs.submit('same', {'text': 'other'})
        finally:
            release.set()
        for _ in range(100):
            result = jobs.submit('same', {'text': 'source'})
            if result['status'] == 'complete':
                break
            time.sleep(0.005)
        self.assertEqual(result['cues'][0]['text'], '译文')
        self.assertEqual(len(calls), 1)

    def test_capacity_is_bounded_and_failure_is_visible(self):
        release = threading.Event()
        jobs = CaptionJobs(lambda _: release.wait(2), max_running=1)
        try:
            jobs.submit('a', {})
            with self.assertRaises(OverflowError):
                jobs.submit('b', {})
        finally:
            release.set()
        def fail(_):
            raise ValueError('字幕编号不匹配')
        jobs = CaptionJobs(fail)
        for _ in range(100):
            result = jobs.submit('a', {})
            if result['status'] == 'failed':
                break
            time.sleep(0.005)
        self.assertEqual(result['error'], '字幕编号不匹配')

    def test_http_contract_origin_validation_and_short_running_response(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        client = TestClient(app)
        release = threading.Event()
        jobs = CaptionJobs(lambda _: release.wait(2))
        body = {'requestId': 'endpoint-test', 'translator': 'kimi_subscription', 'cues': [{'id': 'a', 'text': 'Risk.'}]}
        try:
            with patch('quant_scholar_translator.realtime.caption_jobs', jobs):
                response = client.post('/translate/cues/jobs', json=body)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['status'], 'running')
                self.assertEqual(client.post('/translate/cues/jobs', json=body).json()['id'], body['requestId'])
                self.assertEqual(client.post('/translate/cues/jobs', json=body, headers={'origin': 'https://untrusted.example'}).status_code, 403)
                body['cues'] *= 2
                self.assertEqual(client.post('/translate/cues/jobs', json=body).status_code, 422)
        finally:
            release.set()

    def test_validation_errors_expose_field_rules_without_lecture_text(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        client = TestClient(app)
        with self.assertLogs('quant-scholar-translator', level='WARNING') as logs:
            response = client.post('/translate/cues/jobs', json={
                'requestId': 'probe', 'sourceLang': None,
                'cues': [{'id': 'a', 'text': 'PRIVATE LECTURE SOURCE'}]})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['issues'][0]['field'], 'body.sourceLang')
        self.assertNotIn('PRIVATE LECTURE', response.text + str(logs.output))

    def test_persisted_codex_alias_ten_cue_batch_resumes_same_job(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        client = TestClient(app)
        for first, second in [('codex', 'codex_subscription'), ('codex_subscription', 'codex')]:
            calls = []
            def run(payload):
                calls.append(payload)
                return [{'id': row['id'], 'text': '译文'} for row in payload['cues']]
            jobs = CaptionJobs(run)
            body = {'requestId': 'legacy-pending', 'translator': first,
                    'sourceLang': 'en', 'targetLang': 'zh', 'domain': 'mathematics',
                    'cues': [{'id': f'original:{i}', 'text': 'Risk.'} for i in range(10)]}
            with patch('quant_scholar_translator.realtime.caption_jobs', jobs):
                response = client.post('/translate/cues/jobs', json=body)
                self.assertEqual(response.status_code, 200)
                body['translator'] = second
                for _ in range(100):
                    response = client.post('/translate/cues/jobs', json=body)
                    self.assertEqual(response.status_code, 200)
                    if response.json()['status'] == 'complete':
                        break
                    time.sleep(0.005)
                self.assertEqual(response.json()['status'], 'complete')
                self.assertEqual(response.json()['id'], body['requestId'])
                self.assertEqual([r['id'] for r in response.json()['cues']], [r['id'] for r in body['cues']])
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0]['translator'], 'codex_subscription')
                self.assertEqual(calls[0]['cues'], body['cues'])
                body['translator'] = 'kimi_subscription'
                self.assertEqual(client.post('/translate/cues/jobs', json=body).status_code, 409)

    def test_provider_alias_does_not_enable_unknown_or_api_engines(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        client = TestClient(app)
        with patch('quant_scholar_translator.realtime.caption_jobs.submit') as submit:
            for provider in ['llm', 'unknown', 'Codex']:
                response = client.post('/translate/cues/jobs', json={
                    'requestId': 'invalid', 'translator': provider, 'cues': [{'id': 'a', 'text': 'Risk.'}]})
                self.assertEqual(response.status_code, 422)
            submit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
