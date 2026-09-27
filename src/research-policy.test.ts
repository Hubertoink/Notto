import { expect, it } from 'vitest';
import { researchCandidates } from './research-policy';

it('limits background topics to two while retaining task/contact indices', () => {
  const suggestions = ['insight', 'topic', 'task', 'topic', 'topic', 'contact'].map((kind) => ({
    kind,
    title: 'Thema',
    detail: 'Kontext',
    quote: 'Beleg',
  }));
  expect(researchCandidates(suggestions).map(({ index }) => index)).toEqual([1, 2, 3, 5]);
});
