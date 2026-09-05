import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

import numpy as np
from quant_scholar_translator import realtime as rt


class Socket:
    def __init__(self, messages=()):
        self.messages = iter(messages)
        self.sent = []
        self.client = SimpleNamespace(host='testclient')
        self.query_params = {}

    async def accept(self):
        pass

    async def receive(self):
        return next(self.messages)

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class CompletenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_quiet_chunks_and_repeated_words_are_not_dropped(self):
        session = rt.Session(translation_mode='professional')
        session.translation_queue = asyncio.Queue()
        ws = Socket()
        pcm = np.full(1600, 70, dtype=np.int16).tobytes()
        with patch.object(rt, 'transcribe_chunk', return_value=('risk', 'en')) as transcribe:
            for _ in range(2):
                await rt._handle_chunk(ws, session, asyncio.get_running_loop(), pcm, time.monotonic() - 100)
        self.assertEqual(transcribe.call_count, 2)
        self.assertEqual(session.pending, 'risk risk')

    async def test_stop_flushes_unpunctuated_tail_and_waits_for_translation(self):
        ws = Socket([
            {'text': json.dumps({'type': 'config', 'translationMode': 'professional'})},
            {'bytes': np.full(1600, 1000, dtype=np.int16).tobytes()},
            {'text': '{"type":"flush"}'},
            {'type': 'websocket.disconnect'},
        ])
        with patch.object(rt, 'transcribe_chunk', return_value=('the last example', 'en')):
            with patch.object(rt, '_render_source', new=AsyncMock(return_value='最后一个例子')):
                await rt.handle_socket(ws)
        committed = next(m for m in ws.sent if m.get('stage') == 'source-final')
        final = next(m for m in ws.sent if m.get('isFinal'))
        self.assertEqual(committed['raw'], 'the last example')
        self.assertEqual(committed['chunkId'], final['chunkId'])
        self.assertEqual(final['text'], '最后一个例子')
        self.assertEqual(ws.sent[-1]['type'], 'flushed')

    async def test_failed_translation_keeps_committed_source_and_retries(self):
        session = rt.Session(pending='Complete source.', translation_mode='professional')
        session.translation_queue = asyncio.Queue()
        ws = Socket()
        await rt.commit_pending(ws, session, asyncio.get_running_loop())
        self.assertEqual(ws.sent[0]['stage'], 'source-final')
        await session.translation_queue.put(None)
        with patch.object(rt, '_render_source', new=AsyncMock(side_effect=RuntimeError('offline'))) as translate:
            with patch.object(rt.asyncio, 'sleep', new=AsyncMock()):
                await rt._professional_translation_worker(ws, session, asyncio.get_running_loop())
        self.assertEqual(translate.await_count, 3)
        await asyncio.wait_for(session.translation_queue.join(), timeout=1)
        self.assertFalse(any(m.get('isFinal') for m in ws.sent))
        self.assertEqual(ws.sent[-1]['type'], 'error')


if __name__ == '__main__':
    unittest.main()
