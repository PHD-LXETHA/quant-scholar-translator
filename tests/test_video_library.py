import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quant_scholar_translator.video_library import VideoLibrary, document_key, document_filename


def session():
    return {'id': 's', 'url': 'https://learn.cqf.com/course?token=PRIVATE', 'title': '随机过程 / Part 01',
            'captureMode': 'full-captions', 'sourceLanguage': 'en',
            'full': {'identity': 'video-1', 'duration': 60,
                     'signature': json.dumps(['cue-alignment-v2', 'auto', 'zh', 'auto', 'professional', 'codex']),
                     'pending': {'body': {'requestId': 'private-job'}}},
            'segments': [{'id': 'a', 'source': 'Variance.', 'translation': '方差。', 'mediaTime': 1.2, 'end': 2.1, 'timingVersion': 2},
                         {'id': 'b', 'source': 'Risk.', 'translation': '', 'mediaTime': 3.2, 'end': 4.1, 'timingVersion': 2}]}


class VideoLibraryTests(unittest.TestCase):
    def test_one_markdown_updated_without_losing_existing_translations(self):
        with tempfile.TemporaryDirectory() as temp:
            library = VideoLibrary(temp)
            record = session()
            first = library.save(record)
            self.assertIn('1/2', Path(first['path']).read_text(encoding='utf-8'))
            record['segments'][1]['translation'] = '风险。'
            second = library.save(record)
            self.assertEqual(first['path'], second['path'])
            self.assertEqual(len(list(Path(temp).glob('*.md'))), 1)
            self.assertIn('00:00:01.200 → 00:00:02.100', Path(second['path']).read_text(encoding='utf-8'))
            self.assertIn('2/2', Path(second['path']).read_text(encoding='utf-8'))
            library.save(session())  # A stale partial snapshot must not erase progress.
            restored = library.lookup(record['url'], 'video-1', record['full']['signature'], 60)
            self.assertEqual(restored['segments'][1]['translation'], '风险。')
            data = (Path(temp) / '.data' / (first['key'] + '.json')).read_text(encoding='utf-8')
            self.assertNotIn('PRIVATE', data)
            self.assertNotIn('private-job', data)

    def test_matching_uses_origin_video_language_and_settings_not_page_title(self):
        record = session()
        with tempfile.TemporaryDirectory() as temp:
            library = VideoLibrary(temp)
            library.save(record)
            sig = record['full']['signature']
            self.assertIsNone(library.lookup(record['url'], 'video-2', sig, 60))
            self.assertIsNone(library.lookup('https://other.example/course', 'video-1', sig, 60))
            self.assertIsNone(library.lookup(record['url'], 'video-1', sig, 90))
            self.assertIsNone(library.lookup(record['url'], 'video-1', sig.replace('"zh"', '"fr"'), 60))
            self.assertIsNotNone(library.lookup(record['url'], 'video-1', sig.replace('"codex"', '"codex_subscription"'), 60))

    def test_invalid_or_changed_sources_cannot_overwrite_document(self):
        with tempfile.TemporaryDirectory() as temp:
            library = VideoLibrary(temp)
            record = session()
            saved = library.save(record)
            before = Path(saved['path']).read_text(encoding='utf-8')
            for mutate in [lambda s: s['segments'][0].update(source='Different.'),
                           lambda s: s['segments'][0].update(end=float('nan')),
                           lambda s: s['full'].update(identity='blob:temporary')]:
                bad = copy.deepcopy(record); mutate(bad)
                with self.assertRaises(ValueError): library.save(bad)
            self.assertEqual(Path(saved['path']).read_text(encoding='utf-8'), before)
            self.assertEqual(len(list(Path(temp).rglob('.qs-*'))), 0)

    def test_endpoints_are_local_only_and_never_call_models(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        with tempfile.TemporaryDirectory() as temp, patch('quant_scholar_translator.realtime.video_library', VideoLibrary(temp)), patch('quant_scholar_translator.realtime.run_codex_completion') as model:
            client = TestClient(app)
            self.assertEqual(client.post('/library/videos/save', json=session(), headers={'origin': 'https://evil.example'}).status_code, 403)
            response = client.post('/library/videos/save', json=session(), headers={'origin': 'chrome-extension://test'})
            self.assertEqual(response.status_code, 200)
            record = session()
            response = client.post('/library/videos/lookup', json={
                'url': record['url'], 'identity': 'video-1', 'signature': record['full']['signature'], 'duration': 60})
            self.assertEqual(response.json()['session']['segments'][0]['translation'], '方差。')
            remote = TestClient(app, client=('192.168.1.20', 1234))
            self.assertEqual(remote.post('/library/videos/save', json=session()).status_code, 403)
            model.assert_not_called()

    def test_cross_language_key_fixture(self):
        s = session()
        self.assertEqual(document_key(s['url'], s['full']['identity'], s['full']['signature']),
                         document_key('https://learn.cqf.com/another', 'video-1', s['full']['signature'].replace('codex', 'codex_subscription')))

    def test_sequence_names_are_stable_across_updates_and_restarts(self):
        with tempfile.TemporaryDirectory() as temp:
            record = session()
            first = VideoLibrary(temp).save(record)
            self.assertEqual(Path(first['path']).name, '00001 - 随机过程 Part 01.md')
            record['title'] = 'Changed page title'
            self.assertEqual(VideoLibrary(temp).save(record)['path'], first['path'])
            record['full']['identity'] = 'video-2'
            second = VideoLibrary(temp).save(record)
            self.assertEqual(Path(second['path']).name, '00002 - Changed page title.md')
            # Removing the first generated file does not renumber/reuse its ID.
            Path(first['path']).unlink()
            record['full']['identity'] = 'video-3'
            self.assertTrue(Path(VideoLibrary(temp).save(record)['path']).name.startswith('00003 - '))

    def test_legacy_rename_preserves_bytes_and_replay_data(self):
        with tempfile.TemporaryDirectory() as temp:
            library = VideoLibrary(temp)
            record = session()
            saved = library.save(record)
            original = Path(saved['path'])
            legacy = Path(temp) / ('视频双语-' + saved['key'][:16] + '.md')
            original.rename(legacy)
            before = legacy.read_bytes()
            data_path = Path(temp) / '.data' / (saved['key'] + '.json')
            data_before = data_path.read_bytes()
            result = library.migrate_legacy_documents()
            self.assertEqual(result, [str(original)])
            self.assertEqual(original.read_bytes(), before)
            self.assertEqual(data_path.read_bytes(), data_before)
            self.assertEqual(library.migrate_legacy_documents(), [])
            self.assertIsNotNone(library.lookup(record['url'], 'video-1', record['full']['signature'], 60))

    def test_title_cannot_escape_directory_and_invalid_catalog_cannot_reset_numbers(self):
        self.assertEqual(document_filename('CON', 1), '00001 - 视频 CON.md')
        self.assertNotRegex(document_filename('../C:\\a<>:*?|\n', 1), r'[<>:"/\\|?*\x00-\x1f]')
        self.assertLess(len(document_filename('长标题' * 500, 1)), 100)
        with tempfile.TemporaryDirectory() as temp:
            library = VideoLibrary(temp)
            saved = library.save(session())
            catalog = Path(temp) / '.data' / 'catalog.json'
            catalog.write_text('{"version":99,"entries":{}}', encoding='utf-8')
            before = Path(saved['path']).read_bytes()
            with self.assertRaises(ValueError): library.save(session())
            self.assertEqual(Path(saved['path']).read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
