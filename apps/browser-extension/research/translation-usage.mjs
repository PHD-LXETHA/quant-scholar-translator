export function estimateTranslationUsage({ sourceChars = 0, promptChars = 0, batchCount = 0 } = {}) {
  const source = Math.max(0, Number(sourceChars) || 0), prompt = Math.max(0, Number(promptChars) || 0), batches = Math.max(0, Number(batchCount) || 0);
  const protocolChars = 260;
  const inputChars = source + batches * (prompt + protocolChars);
  return {
    sourceChars: Math.round(source),
    inputTokens: Math.ceil(inputChars / 3.8),
    outputTokens: Math.ceil(source / 2.4),
    totalTokens: Math.ceil(inputChars / 3.8) + Math.ceil(source / 2.4),
    batchCount: Math.round(batches)
  };
}

export function translationProgress(pages) {
  const pageList = Array.isArray(pages) ? pages : [];
  const blocks = pageList.flatMap(page => (page.blocks || []).filter(block => !["figure-content", "artifact"].includes(block.role)));
  const completed = blocks.filter(block => block.translation).length;
  const completedPages = pageList.filter(page => {
    const translatable = (page.blocks || []).filter(block => !["figure-content", "artifact"].includes(block.role));
    return translatable.length > 0 && translatable.every(block => block.translation);
  }).length;
  return { total: blocks.length, completed, completedPages, totalPages: pageList.length, percent: blocks.length ? Math.round(completed / blocks.length * 100) : 0 };
}
