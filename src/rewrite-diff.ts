export type RewriteLine = { kind: 'same' | 'added' | 'removed'; text: string };

// Bound memory for notes with many short lines. Large replacements remain visible
// as a whole rather than risking an unresponsive editor.
export function rewriteDiff(before: string, after: string): RewriteLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end])
    end++;
  const result: RewriteLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const old = a.slice(start, a.length - end);
  const next = b.slice(start, b.length - end);
  if ((old.length + 1) * (next.length + 1) > 1_000_000) {
    result.push(
      ...old.map((text) => ({ kind: 'removed' as const, text })),
      ...next.map((text) => ({ kind: 'added' as const, text })),
    );
  } else {
    const width = next.length + 1;
    const lengths = new Uint32Array((old.length + 1) * width);
    for (let i = old.length - 1; i >= 0; i--)
      for (let j = next.length - 1; j >= 0; j--)
        lengths[i * width + j] =
          old[i] === next[j]
            ? lengths[(i + 1) * width + j + 1] + 1
            : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < old.length || j < next.length) {
      if (i < old.length && j < next.length && old[i] === next[j]) {
        result.push({ kind: 'same', text: old[i++] });
        j++;
      } else if (
        i < old.length &&
        (j === next.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
      ) {
        result.push({ kind: 'removed', text: old[i++] });
      } else result.push({ kind: 'added', text: next[j++] });
    }
  }
  result.push(...a.slice(a.length - end).map((text) => ({ kind: 'same' as const, text })));
  return result;
}
