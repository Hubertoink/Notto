// Shared, deterministic retrieval: no network, model calls, or notebook mutations.
export interface SearchChunk {
  noteId: string;
  revision: string;
  text: string;
  attachment?: string;
  page?: number;
  title?: string;
}
const stopWords = new Set(
  'der die das den dem des ein eine einer einen und oder aber mit für von auf aus ist sind war was wie wer wann wo welche welcher welches bitte meine meinen notizen projekt'.split(
    ' ',
  ),
);
export function searchTerms(query: string) {
  return [...new Set(query.toLocaleLowerCase('de').match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter(
    (t) => !stopWords.has(t),
  );
}
export function lexicalScore(chunk: SearchChunk, query: string) {
  const terms = searchTerms(query);
  const text = chunk.text.toLocaleLowerCase('de'),
    title = (chunk.title ?? '').toLocaleLowerCase('de');
  return (
    terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0), 0) /
    Math.max(1, terms.length * 3)
  );
}
export function splitEvidence<T extends SearchChunk>(sources: T[]): T[] {
  return sources.flatMap((source) => {
    const chunks: T[] = [];
    for (let offset = 0; offset < source.text.length; offset += 1800)
      chunks.push({ ...source, text: source.text.slice(offset, offset + 2000) });
    return chunks;
  });
}
export function diverseHits<T extends SearchChunk & { score: number }>(hits: T[], limit = 12): T[] {
  const ranked = [...hits].sort((a, b) => b.score - a.score);
  const selected: T[] = [];
  const seen = new Set<string>();
  // First reserve one place per note. Only then add a second passage per note.
  for (const hit of ranked) {
    if (seen.has(hit.noteId)) continue;
    seen.add(hit.noteId);
    selected.push(hit);
    if (selected.length === limit) return selected;
  }
  for (const hit of ranked) {
    if (selected.includes(hit) || selected.filter((s) => s.noteId === hit.noteId).length >= 2) continue;
    selected.push(hit);
    if (selected.length === limit) break;
  }
  return selected;
}
