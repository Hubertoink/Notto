import { expect, it } from 'vitest';
import { automaticReviewAllowed } from './automatic-review';

it('allows three completed reviews per note and counts neither sources nor other notebooks', () => {
  const note = { id: 'note', scope: 'local' };
  const records = [0, 1, 2].map((id) => ({
    id: String(id),
    scope: note.scope,
    noteId: note.id,
    kind: 'analysis',
  }));
  expect(automaticReviewAllowed(records.slice(0, 2), note)).toBe(true);
  expect(automaticReviewAllowed(records, note)).toBe(false);
  expect(automaticReviewAllowed([...records.slice(0, 2), records[0]], note)).toBe(true);
  expect(
    automaticReviewAllowed(
      records.map((r) => ({ ...r, kind: 'research' })),
      note,
    ),
  ).toBe(true);
  expect(automaticReviewAllowed(records, { ...note, id: 'another' })).toBe(true);
  expect(automaticReviewAllowed(records, { ...note, scope: 'another' })).toBe(true);
});
