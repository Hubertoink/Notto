import { expect, it } from 'vitest';
import { noteLinkHref, noteLinkRanges, parseNoteLink, plainNoteLinks } from './note-links';

const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';

it('stores several typed targets in one internal note link', () => {
  const href = noteLinkHref([
    { id: one, relation: 'theory' },
    { id: two, relation: 'context' },
  ]);
  expect(parseNoteLink(href)).toEqual([
    { id: one, relation: 'theory' },
    { id: two, relation: 'context' },
  ]);
  expect(noteLinkRanges(`[Begriff](${href})`)[0].targets).toHaveLength(2);
  expect(plainNoteLinks(`Vor [Begriff](${href}) nach`)).toBe('Vor Begriff nach');
});

it('rejects malformed targets and ignores examples in code', () => {
  expect(parseNoteLink(`notes/${one}?also=broken`)).toEqual([]);
  expect(noteLinkRanges('`[Begriff](notes/' + one + ')`')).toEqual([]);
});
