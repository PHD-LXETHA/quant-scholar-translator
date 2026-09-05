// User content is always text, never injected HTML or Markdown.
(async () => {
  const id = new URL(location.href).searchParams.get('id');
  const heading = document.getElementById('title');
  try {
    if (!/^bilingual-pdf-[\w-]+$/.test(id || '')) throw new Error('无效的导出编号');
    const cached = sessionStorage.getItem(id);
    const data = cached ? JSON.parse(cached) : (await chrome.storage.local.get(id))[id];
    if (!data?.segments?.length || data.segments.some(s => !String(s.translation || '').trim())) throw new Error('没有完整双语记录，请回到菜单生成译文后重试');
    sessionStorage.setItem(id, JSON.stringify(data));
    await chrome.storage.local.remove(id); // Transfer the immutable snapshot to this preview tab.
    heading.textContent = document.title = data.title || '视频双语学习文本';
    document.getElementById('source').textContent = `来源：${data.url || '未记录'}`;
    document.getElementById('meta').textContent = `${data.segments.length} 条对照记录 · ${data.sourceLanguage || '原文'} → ${data.targetLanguage || '译文'} · 请结合原文核对专业术语与公式`;
    const stamp = t => !Number.isFinite(t) ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const rows = document.createDocumentFragment();
    for (const [i, item] of data.segments.entries()) {
      const article = document.createElement('article'), title = document.createElement('h2');
      title.textContent = `${i + 1}. ${stamp(item.mediaTime)}${Number.isFinite(item.end) ? ` - ${stamp(item.end)}` : ''}`;
      article.append(title);
      for (const [label, text] of [['原文', item.source], ['译文', item.translation]]) {
        const tag = document.createElement('p'), body = document.createElement('p');
        tag.className = 'label'; tag.textContent = label;
        body.className = 'text'; body.textContent = text || '';
        article.append(tag, body);
      }
      rows.append(article);
    }
    document.getElementById('entries').append(rows);
    const print = document.getElementById('print'); print.disabled = false;
    print.onclick = () => window.print();
  } catch (error) { heading.textContent = error.message || '导出预览载入失败'; }
})();
