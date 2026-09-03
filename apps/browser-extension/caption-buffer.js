// Pure source-only buffering. Preview translations never enter this module.
export function mergeCaptionSource(previous, incoming) {
  const left = String(previous || '').replace(/\s+/g, ' ').trim();
  const right = String(incoming || '').replace(/\s+/g, ' ').trim();
  if (!left) return right;
  if (!right || left.toLocaleLowerCase().endsWith(right.toLocaleLowerCase())) return left;
  if (right.toLocaleLowerCase().startsWith(left.toLocaleLowerCase())) return right;
  const a = left.split(' '), b = right.split(' ');
  for (let count = Math.min(a.length, b.length); count > 0; count--) {
    if (a.slice(-count).join(' ').toLocaleLowerCase() === b.slice(0, count).join(' ').toLocaleLowerCase()) {
      return [...a, ...b.slice(count)].join(' ');
    }
  }
  return `${left} ${right}`;
}

export function shouldCommitCaption(source, elapsedMs = 0) {
  return /[.!?…。！？؟;:]$/.test(String(source).trim()) || source.length >= 160 || elapsedMs >= 6000;
}
