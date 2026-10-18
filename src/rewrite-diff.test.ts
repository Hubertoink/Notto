import { expect, it } from 'vitest';
import { rewriteDiff } from './rewrite-diff';

it('marks replacements, additions and deletions while retaining unchanged lines', () => {
  expect(rewriteDiff('Titel\nAlt\nBleibt\nEntfernt', 'Titel\nNeu\nBleibt')).toEqual([
    { kind: 'same', text: 'Titel' },
    { kind: 'removed', text: 'Alt' },
    { kind: 'added', text: 'Neu' },
    { kind: 'same', text: 'Bleibt' },
    { kind: 'removed', text: 'Entfernt' },
  ]);
});

it('reconstructs both versions including repeated and blank lines and large replacements', () => {
  for (const [before, after] of [
    ['gleich\n\ngleich\nEnde', 'gleich\nneu\ngleich\nEnde'],
    ['', 'Neu'],
    ['Alt', ''],
    ['Unverändert', 'Unverändert'],
    ['a\n'.repeat(1500), 'b\n'.repeat(1500)],
  ]) {
    const lines = rewriteDiff(before, after);
    expect(
      lines
        .filter((line) => line.kind !== 'added')
        .map((line) => line.text)
        .join('\n'),
    ).toBe(before);
    expect(
      lines
        .filter((line) => line.kind !== 'removed')
        .map((line) => line.text)
        .join('\n'),
    ).toBe(after);
  }
});
