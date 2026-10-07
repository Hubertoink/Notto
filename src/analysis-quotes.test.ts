import { expect, it } from 'vitest';
import { groundAnalysis } from './evidence-policy';
const result = (quote: string, kind: 'topic' | 'insight' = 'topic') => ({
  suggestions: [{ kind, title: 'Ownership', detail: '', quote }],
});

it('restores actual PDF spacing while keeping a verifiable literal quote', () => {
  const text = 'Ownership\n\n  fördert\tVerantwortung\u00a0im Team.';
  const grounded = groundAnalysis(result('Ownership fördert Verantwortung im Team.', 'insight'), [
    { text, attachment: 'article.pdf' },
  ]);
  expect(grounded.suggestions[0].quote).toBe(text);
  expect(text.includes(grounded.suggestions[0].quote)).toBe(true);
});
it('keeps exact excerpts and escapes punctuation instead of treating quotes as patterns', () => {
  expect(
    groundAnalysis(result('Ownership (Team) + Verantwortung?'), [
      { text: 'Ownership (Team) + Verantwortung?' },
    ]).suggestions[0].quote,
  ).toBe('Ownership (Team) + Verantwortung?');
  expect(() =>
    groundAnalysis(result('Ownership (Team) + Verantwortung?'), [{ text: 'Ownership Team Verantwortung' }]),
  ).toThrow('KI-Beleg');
});
it('rejects paraphrases, changed punctuation, empty quotes and quotes spanning separate sources', () => {
  for (const quote of [
    'Ownership stärkt Verantwortung.',
    'ownership fördert Verantwortung.',
    'Ownership fördert Verantwortung!',
    '  ',
  ])
    expect(() => groundAnalysis(result(quote), [{ text: 'Ownership fördert Verantwortung.' }])).toThrow(
      'KI-Beleg',
    );
  expect(() =>
    groundAnalysis(result('Ownership fördert Verantwortung.'), [
      { text: 'Ownership fördert' },
      { text: 'Verantwortung.' },
    ]),
  ).toThrow('KI-Beleg');
});
it('still requires an actual PDF source for PDF insights', () => {
  expect(() =>
    groundAnalysis(result('Ownership im Team.', 'insight'), [{ text: 'Ownership\nim Team.' }]),
  ).toThrow('KI-Beleg');
  expect(() =>
    groundAnalysis(result('Kein Text erkannt.', 'insight'), [
      { text: '[Kein Text erkannt.]', attachment: 'article.pdf' },
    ]),
  ).toThrow('KI-Beleg');
});
