"""Bounded in-memory transcription of user-requested clear media files.

No remote URL fetching, DRM decryption, external playlists, or recordings on disk.
"""
from __future__ import annotations

import asyncio
import io
import threading
import time
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request

MAX_BYTES = 128 * 1024 * 1024
MAX_SECONDS = 4 * 3600


def container_format(data: bytes) -> str:
    if len(data) >= 12 and data[4:8] == b'ftyp':
        return 'mov'
    if data.startswith(b'RIFF') and data[8:12] == b'WAVE':
        return 'wav'
    if data.startswith(b'fLaC'):
        return 'flac'
    if data.startswith(b'OggS'):
        return 'ogg'
    if data.startswith(b'\x1a\x45\xdf\xa3'):
        return 'matroska'
    if data.startswith(b'ID3') or (len(data) > 2 and data[0] == 255 and data[1] & 0xe0 == 0xe0):
        return 'mp3'
    raise ValueError('只支持普通 MP3/M4A/MP4/WAV/FLAC/OGG/WebM 文件，不处理播放清单或加密分片')


def transcribe_media(data, job, get_model):
    import av
    import numpy as np

    try:
        fmt = container_format(data)
        with av.open(io.BytesIO(data), format=fmt, options={'protocol_whitelist': 'pipe'}) as container:
            stream = next(iter(container.streams.audio), None)
            if stream is None:
                raise ValueError('文件没有音轨')
            duration = float(stream.duration * stream.time_base) if stream.duration and stream.time_base else 0
            if duration > MAX_SECONDS:
                raise ValueError('完整音轨处理上限为 4 小时，请分段或使用实时识别')
            model = get_model(offline=job['offline'])
            resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
            chunks, samples, offset = [], 0, 0
            cues = []

            def recognize(pcm):
                nonlocal offset
                if job['cancel'].is_set():
                    raise InterruptedError('已取消完整音轨识别')
                segments, _info = model.transcribe(pcm.astype(np.float32) / 32768.0,
                    language=None if job['source_lang'] == 'auto' else job['source_lang'], task='transcribe',
                    vad_filter=True, beam_size=5, condition_on_previous_text=False,
                    hotwords=job['hotwords'])
                for segment in segments:
                    if job['cancel'].is_set():
                        raise InterruptedError('已取消完整音轨识别')
                    text = segment.text.strip()
                    if text:
                        cues.append({'start': offset / 16000 + segment.start,
                                     'end': offset / 16000 + segment.end, 'text': text})
                offset += pcm.size
                if offset / 16000 > MAX_SECONDS:
                    raise ValueError('音轨超过 4 小时处理上限')
                job['progress'] = min(99, round(offset / 16000 / duration * 100)) if duration else None

            for frame in container.decode(stream):
                if job['cancel'].is_set():
                    raise InterruptedError('已取消完整音轨识别')
                for converted in resampler.resample(frame):
                    pcm = converted.to_ndarray().reshape(-1)
                    chunks.append(pcm); samples += pcm.size
                    if samples >= 30 * 16000:
                        recognize(np.concatenate(chunks)); chunks, samples = [], 0
            for converted in resampler.resample(None):
                chunks.append(converted.to_ndarray().reshape(-1))
            if chunks:
                recognize(np.concatenate(chunks))
            if not cues:
                raise ValueError('没有识别到语音，不能标记为完整成功')
            job.update(status='complete', cues=cues, progress=100)
    except InterruptedError:
        job.update(status='cancelled', error='已取消')
    except Exception as error:
        # Decoder errors can contain sensitive container metadata; expose only
        # explicit validation messages, never signed URLs or raw media content.
        job.update(status='failed', error=str(error) if isinstance(error, ValueError) else '音轨解码或识别失败；受保护媒体不支持此路径')
    finally:
        job['finished'] = time.monotonic()


def create_media_router(get_model, hotwords):
    router = APIRouter()
    jobs = {}
    upload_lock = asyncio.Lock()
    tasks = set()

    def check_origin(request):
        origin = request.headers.get('origin')
        if not origin:
            return
        parsed = urlparse(origin)
        if parsed.scheme == 'chrome-extension' or parsed.hostname in ('localhost', '127.0.0.1', '::1'):
            return
        raise HTTPException(403, '完整音轨接口仅供本机扩展或本机工具调用')

    def cleanup():
        for key, job in list(jobs.items()):
            if job.get('finished') and time.monotonic() - job['finished'] > 1800:
                jobs.pop(key, None)

    @router.post('/media/jobs')
    async def start(request: Request, source_lang: str = 'auto', domain: str = 'auto', offline: bool = False):
        check_origin(request)
        if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
            raise HTTPException(415, '请上传普通媒体二进制数据')
        async with upload_lock:
            cleanup()
            if any(j['status'] == 'recognizing' for j in jobs.values()) or len(jobs) >= 4:
                raise HTTPException(429, '已有完整音轨任务，请先完成或取消')
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, '文件超过 128 MB，请使用实时识别')
                data.extend(chunk)
            try:
                container_format(data)
            except ValueError as error:
                raise HTTPException(415, str(error)) from error
            job_id = uuid.uuid4().hex
            job = {'status': 'recognizing', 'progress': 0, 'cancel': threading.Event(),
                   'source_lang': source_lang, 'offline': offline, 'hotwords': hotwords(domain)}
            jobs[job_id] = job
            task = asyncio.create_task(asyncio.to_thread(transcribe_media, bytes(data), job, get_model))
            tasks.add(task); task.add_done_callback(tasks.discard)
            return {'id': job_id, 'status': job['status']}

    @router.get('/media/jobs/{job_id}')
    async def status(job_id: str, request: Request):
        check_origin(request); cleanup()
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, '任务不存在或已过期，请重新开始')
        return {k: job[k] for k in ('status', 'progress', 'error', 'cues') if k in job}

    @router.delete('/media/jobs/{job_id}')
    async def cancel(job_id: str, request: Request):
        check_origin(request)
        job = jobs.get(job_id)
        if job:
            job['cancel'].set()
            if job['status'] != 'recognizing':
                jobs.pop(job_id, None)
        return {'ok': True}

    return router
