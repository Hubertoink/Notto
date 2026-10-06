import { expect, it } from 'vitest';
import { sliceEvidence } from './retrieval';
it('paginates across PDF pages while preserving file and page provenance', () => {
  const sources = [1, 2, 3].map((page) => ({
    noteId: 'source',
    revision: 'version',
    attachment: 'file.pdf',
    page,
    text: String(page).repeat(4000),
  }));
  const result = sliceEvidence(sources, 3000, 6000);
  expect(result.map((source) => [source.page, source.text.length])).toEqual([
    [1, 1000],
    [2, 4000],
    [3, 1000],
  ]);
  expect(result.every((source) => source.attachment === 'file.pdf')).toBe(true);
  expect(sliceEvidence(sources, 12000, 6000)).toEqual([]);
});
