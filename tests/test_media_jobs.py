import io
import threading
import unittest
import wave
from types import SimpleNamespace

import numpy as np
from quant_scholar_translator.media_jobs import transcribe_media, container_format


class MediaJobTests(unittest.TestCase):
    def wav(self, seconds):
        buffer = io.BytesIO()
        samples = (np.sin(np.arange(int(seconds * 16000)) * 0.1) * 12000).astype('<i2')
        with wave.open(buffer, 'wb') as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(16000)
            out.writeframes(samples.tobytes())
        return buffer.getvalue(), samples.size

    def job(self):
        return {'offline': True, 'cancel': threading.Event(), 'source_lang': 'en', 'hotwords': 'variance', 'status': 'recognizing'}

    def test_actual_decoder_preserves_whole_audio_and_tail_timestamps(self):
        data, expected = self.wav(31.25)
        counts = []
        def transcribe(pcm, **kwargs):
            counts.append(len(pcm))
            return iter([SimpleNamespace(start=0, end=len(pcm)/16000, text='Risk.')]), None
        job = self.job()
        transcribe_media(data, job, lambda **kwargs: SimpleNamespace(transcribe=transcribe))
        self.assertEqual(job['status'], 'complete', job.get('error'))
        self.assertEqual(sum(counts), expected)
        self.assertGreater(len(counts), 1)
        self.assertEqual(job['cues'][1]['start'], job['cues'][0]['end'])
        self.assertEqual(job['cues'][-1]['end'], 31.25)

    def test_cancellation_and_playlist_rejection(self):
        data, _ = self.wav(1)
        job = self.job()
        job['cancel'].set()
        transcribe_media(data, job, lambda **kwargs: None)
        self.assertEqual(job['status'], 'cancelled')
        for data in [b'#EXTM3U\nhttps://example.invalid/audio', b'<MPD>encrypted</MPD>', b'12345678moof']:
            with self.assertRaises(ValueError):
                container_format(data)


if __name__ == '__main__':
    unittest.main()
