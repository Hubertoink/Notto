import { expect, it } from 'vitest';
import { researchCandidates, researchInput } from './research-policy';

it('passes explicit note links even when the suggested quote omits them, excluding separate commands', () => {
  const input = JSON.parse(
    researchInput(
      { kind: 'topic', title: 'Lernbüro', detail: 'Einordnung', quote: 'Selbstreguliertes Lernen' },
      '# Selbstreguliertes Lernen\n[Video](https://youtu.be/example)\nhttps://youtu.be/example\n/ki Lies https://example.org/private-command',
    ),
  );
  expect(input.notizlinks).toEqual(['https://youtu.be/example']);
  expect(input.notizausschnitt).toBe('Selbstreguliertes Lernen');
});

it('limits background topics to two while retaining task/contact indices', () => {
  const suggestions = ['insight', 'topic', 'task', 'topic', 'topic', 'contact'].map((kind) => ({
    kind,
    title: 'Thema',
    detail: 'Kontext',
    quote: 'Beleg',
  }));
  expect(researchCandidates(suggestions).map(({ index }) => index)).toEqual([1, 2, 3, 5]);
});
