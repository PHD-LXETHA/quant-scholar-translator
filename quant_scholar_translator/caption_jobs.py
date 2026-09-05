"""Short HTTP requests around long model calls; retries reuse the same job.

Results are memory-only. A stopped browser task does not start more batches;
an already dispatched CLI call may finish and its result can be recovered.
"""
import hashlib
import json
import logging
import threading
import time

log = logging.getLogger('quant-scholar-translator')


class CaptionJobs:
    def __init__(self, runner, max_running=2, max_jobs=2048):
        self.runner = runner
        self.max_running = max_running
        self.max_jobs = max_jobs
        self.jobs = {}
        self.lock = threading.Lock()

    def submit(self, request_id, payload):
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            for key, job in list(self.jobs.items()):
                if job.get('finished') and time.monotonic() - job['finished'] > 3600:
                    del self.jobs[key]
            job = self.jobs.get(request_id)
            if job:
                if job['fingerprint'] != fingerprint:
                    raise ValueError('任务编号对应的字幕已改变，请重新开始')
                return self._snapshot(job)
            if len(self.jobs) >= self.max_jobs or sum(j['status'] == 'running' for j in self.jobs.values()) >= self.max_running:
                raise OverflowError('已有翻译任务运行中，请稍候再试')
            job = {'id': request_id, 'fingerprint': fingerprint, 'status': 'running', 'started': time.monotonic()}
            self.jobs[request_id] = job
            threading.Thread(target=self._run, args=(job, payload), daemon=True).start()
            return self._snapshot(job)

    def _run(self, job, payload):
        count = len(payload.get('cues', []))
        log.info('Caption job started: cues=%d', count)
        try:
            cues = self.runner(payload)
            result = {'status': 'complete', 'cues': cues}
        except ValueError as error:
            result = {'status': 'failed', 'error': str(error)[:500]}
        except Exception:
            # CLI diagnostics can contain local paths/account information.
            result = {'status': 'failed', 'error': '专业翻译失败或超时，请检查所选套餐登录状态及本地服务'}
        with self.lock:
            job.update(result, finished=time.monotonic())
        log.info('Caption job finished: status=%s cues=%d', result['status'], count)

    @staticmethod
    def _snapshot(job):
        return {**{key: job[key] for key in ('id', 'status', 'cues', 'error') if key in job},
                'elapsedSeconds': round(time.monotonic() - job['started'])}
