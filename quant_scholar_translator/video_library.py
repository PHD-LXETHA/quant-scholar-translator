"""Local, per-video bilingual documents. No model calls or media downloads."""
import hashlib
import json
import math
import os
import re
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


DEFAULT_ROOT = Path(__file__).resolve().parent.parent / '学习资料' / '视频双语'


def canonical_signature(value):
    parts = json.loads(value)
    if (not isinstance(parts, list) or len(parts) != 6 or parts[0] != 'cue-alignment-v2'
            or any(not isinstance(p, str) or len(p) > 200 for p in parts)):
        raise ValueError('视频存档设置标识无效')
    if parts[5] == 'codex':
        parts[5] = 'codex_subscription'
    return json.dumps(parts, ensure_ascii=False, separators=(',', ':'))


def page_origin(value):
    url = urlsplit(value)
    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password:
        raise ValueError('视频页面地址无效')
    host = url.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    port = url.port
    return url.scheme + '://' + host + (f':{port}' if port and port != (443 if url.scheme == 'https' else 80) else '')


def document_key(url, identity, signature):
    if not isinstance(identity, str) or not identity or len(identity) > 3000 or identity.startswith(('blob:', 'data:')):
        raise ValueError('播放器缺少稳定视频编号，无法自动建立回看存档')
    raw = json.dumps([page_origin(url), identity, canonical_signature(signature)], ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize_record(session):
    full = session.get('full') or {}
    key = document_key(session.get('url', ''), full.get('identity'), full.get('signature'))
    duration = full.get('duration')
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('视频时长无效')
    rows = session.get('segments')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 8000:
        raise ValueError('视频存档需包含 1～8000 条字幕')
    cues, ids, size = [], set(), 0
    for row in rows:
        identity, source, translated = row.get('id'), row.get('source'), row.get('translation', '')
        start, end = row.get('mediaTime'), row.get('end')
        if (not isinstance(identity, str) or not 1 <= len(identity) <= 200 or identity in ids
                or not isinstance(source, str) or not source.strip() or len(source) > 12000
                or not isinstance(translated, str) or len(translated) > 24000
                or row.get('timingVersion') != 2
                or any(not isinstance(t, (int, float)) or not math.isfinite(t) for t in (start, end))
                or start < 0 or end <= start or end > duration + 5):
            raise ValueError('视频存档字幕编号、正文或时间范围无效')
        size += len(source) + len(translated)
        if size > 4_000_000:
            raise ValueError('视频存档正文超过大小上限')
        ids.add(identity)
        cues.append({'id': identity, 'source': source, 'translation': translated.strip(),
                     'mediaTime': start, 'end': end, 'timingVersion': 2,
                     'stage': 'professional-final' if translated.strip() else 'source-final'})
    if any(b['mediaTime'] < a['mediaTime'] for a, b in zip(cues, cues[1:])):
        raise ValueError('字幕时间顺序无效')
    parts = json.loads(canonical_signature(full['signature']))
    url = urlsplit(session['url'])
    # Course query strings can carry expiring access tokens; not needed for matching.
    safe_url = page_origin(session['url']) + (url.path or '/')
    record = {'schemaVersion': 1, 'id': 'saved-' + key[:16],
              'title': str(session.get('title') or '视频学习记录')[:500], 'url': safe_url,
              'sourceLanguage': str(session.get('sourceLanguage') or parts[1])[:40],
              'targetLanguage': parts[2], 'domain': parts[3], 'translationMode': parts[4],
              'professionalTranslator': parts[5], 'captureMode': session.get('captureMode', 'full-captions'),
              'segments': cues, 'full': {'identity': full['identity'], 'signature': canonical_signature(full['signature']), 'duration': duration}}
    if record['captureMode'] not in ('full-captions', 'full-audio'):
        raise ValueError('仅支持带完整时间戳的视频存档')
    if parts[4] == 'offline':
        for cue in cues:
            if cue['translation']:
                cue['stage'] = 'offline-final'
    return key, record


def timestamp(value):
    millis = round(value * 1000)
    seconds, ms = divmod(millis, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f'{hours:02}:{minutes:02}:{seconds:02}.{ms:03}'


def document_filename(title, number):
    """Readable Windows-safe name with a permanent library sequence number."""
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', ' ', str(title))
    clean = re.sub(r'\s+', ' ', clean).strip(' .')
    # Bound UTF-16 length for Windows, including titles containing emoji.
    clean = clean.encode('utf-16-le', errors='replace')[:160].decode('utf-16-le', errors='ignore').rstrip(' .')
    clean = clean or '视频学习记录'
    if re.fullmatch(r'(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', clean):
        clean = '视频 ' + clean
    return f'{number:05d} - {clean}.md'


def markdown(record):
    rows = record['segments']
    done = sum(bool(r['translation']) for r in rows)
    title = record['title'].replace('\n', ' ').replace('\r', ' ')
    text = [f'# {title}', '', f'来源：{record["url"]}', '',
            f'翻译进度：{done}/{len(rows)} 条 · 引擎：{record["professionalTranslator"]}', '',
            '> 此文档随翻译自动更新。个人批注请另存，避免被后续自动保存覆盖。', '']
    for i, row in enumerate(rows, 1):
        text += [f'## {i:04} · {timestamp(row["mediaTime"])} → {timestamp(row["end"])}', '',
                 '**原文**', '', row['source'], '', '**译文**', '', row['translation'] or '（尚未翻译）', '']
    return '\n'.join(text)


class VideoLibrary:
    def __init__(self, root=DEFAULT_ROOT):
        self.root = Path(root).resolve()
        self.lock = threading.RLock()

    def _data_path(self, key):
        if not re.fullmatch('[a-f0-9]{64}', key):
            raise ValueError('视频存档编号无效')
        return self.root / '.data' / (key + '.json')

    def _catalog_entry(self, record, key):
        path = self.root / '.data' / 'catalog.json'
        if path.is_symlink() or path.resolve().parent != (self.root / '.data').resolve():
            raise ValueError('存档目录索引路径不安全')
        catalog = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'version': 1, 'entries': {}}
        entries = catalog.get('entries') if isinstance(catalog, dict) else None
        if not isinstance(catalog, dict) or catalog.get('version') != 1 or not isinstance(entries, dict):
            raise ValueError('存档序号索引无效，未重新编号')
        used = set()
        for identity, item in entries.items():
            if (not re.fullmatch('[a-f0-9]{64}', identity) or not isinstance(item, dict)
                    or type(item.get('number')) is not int or item['number'] < 1
                    or item['number'] in used or not isinstance(item.get('title'), str)):
                raise ValueError('存档序号索引无效，未重新编号')
            used.add(item['number'])
        if key not in entries:
            # Do not reuse removed entries, or collide with a manually copied MD.
            for existing in self.root.glob('*.md'):
                match = re.match(r'^(\d+) - ', existing.name)
                if match:
                    used.add(int(match[1]))
            entries[key] = {'number': max(used, default=0) + 1, 'title': record['title']}
            self._atomic_write(path, json.dumps(catalog, ensure_ascii=False))
        return entries[key]

    def _document_path(self, record, key):
        entry = self._catalog_entry(record, key)
        path = self.root / document_filename(entry['title'], entry['number'])
        if path.is_symlink() or path.resolve().parent != self.root:
            raise ValueError('存档文档路径不安全')
        return path

    def _rename_legacy(self, record, key):
        target = self._document_path(record, key)
        legacy = self.root / ('视频双语-' + key[:16] + '.md')
        if legacy.exists():
            if legacy.is_symlink() or legacy.resolve().parent != self.root:
                raise ValueError('旧存档路径不安全')
            if target.exists():
                raise ValueError('新旧存档同时存在，未覆盖，请先核对文件')
            legacy.rename(target)
            return target
        return None

    def migrate_legacy_documents(self):
        """Rename existing generated MD files byte-for-byte, without model calls."""
        renamed = []
        with self.lock:
            for path in (self.root / '.data').glob('*.json'):
                if not re.fullmatch('[a-f0-9]{64}', path.stem):
                    continue
                key, record = normalize_record(json.loads(path.read_text(encoding='utf-8')))
                if key != path.stem:
                    raise ValueError('存档编号不一致，未重命名')
                target = self._rename_legacy(record, key)
                if target:
                    renamed.append(str(target))
        return renamed

    @staticmethod
    def _atomic_write(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.qs-', delete=False) as stream:
                temp = Path(stream.name)
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            if temp and temp.exists():
                temp.unlink()

    def lookup(self, url, identity, signature, duration):
        key = document_key(url, identity, signature)
        with self.lock:
            path = self._data_path(key)
            if not path.exists():
                return None
            if path.stat().st_size > 32 * 1024 * 1024:
                raise ValueError('视频存档文件过大')
            record = json.loads(path.read_text(encoding='utf-8'))
            verified, record = normalize_record(record)
            if verified != key or not isinstance(duration, (int, float)) or abs(record['full']['duration'] - duration) > 2:
                return None
            return record

    def save(self, session):
        key, record = normalize_record(session)
        with self.lock:
            old = self.lookup(record['url'], record['full']['identity'], record['full']['signature'], record['full']['duration'])
            if old:
                if (len(old['segments']) != len(record['segments']) or any(
                        (a['source'], a['mediaTime'], a['end']) != (b['source'], b['mediaTime'], b['end'])
                        for a, b in zip(old['segments'], record['segments']))):
                    raise ValueError('同编号视频的原字幕已改变，未覆盖原有学习文档')
                for previous, row in zip(old['segments'], record['segments']):
                    if not row['translation'] and previous['translation']:
                        row['translation'], row['stage'] = previous['translation'], previous['stage']
            # Stable names: subsequent snapshots update one document, not new downloads.
            document = self._document_path(record, key)
            self._rename_legacy(record, key)
            self._atomic_write(self._data_path(key), json.dumps(record, ensure_ascii=False))
            self._atomic_write(document, markdown(record))
            return {'key': key, 'path': str(document),
                    'done': sum(bool(r['translation']) for r in record['segments']), 'total': len(record['segments'])}
