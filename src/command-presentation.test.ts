import { expect, it } from 'vitest';
import { readPresentation, storePresentation, presentationInstructions } from './command-presentation';
import { commandResultMarkdown, itemTaskText } from './command-result-text';
import type { CommandResult } from './note-command';

it('resolves forward references, preserves order, and stores a canonical program', () => {
  const value = storePresentation(
    'root = Answer([comparison, steps, sources])\ncomparison = Comparison([2, 0])\nsteps = Plan([1])\nsources = SourceCards([3])',
    4,
  )!;
  expect(value.source).toBe('root = Answer([Comparison([2,0]),Plan([1]),SourceCards([3])])');
  expect(readPresentation(JSON.parse(JSON.stringify(value)), 4)).toEqual([
    { type: 'Comparison', items: [2, 0] },
    { type: 'Plan', items: [1] },
    { type: 'SourceCards', items: [3] },
  ]);
  expect(presentationInstructions).not.toContain('Your ENTIRE response');
});

it.each([
  'root = Answer([SourceCards([0])])', // missing an item
  'root = Answer([SourceCards([0, 0])])',
  'root = Answer([SourceCards([0, 2])])',
  'root = Answer([Comparison([0]), Plan([1])])',
  'root = Answer([SourceCards([0, 1])',
  'root = Answer([missing])',
  'root = Answer([Evil([0, 1])])',
  'root = Answer([SourceCards([0, 1])])\nx = SourceCards([0])',
  'root = Answer([SourceCards([0, 1])])\nquery = Query("send", {})',
  'root = Answer([SourceCards([0, 1])])\n$x = 1',
  'root = Answer([SourceCards([0, 1])])\nx = Mutation("send", {})',
  'root = Answer([SourceCards([0, 1])])\n@OpenUrl("https://evil.test")',
  'root = Answer([SourceCards([0, 1], "invented text")])',
])('falls back rather than executing or silently dropping content: %s', (source) => {
  expect(storePresentation(source, 2)).toBeUndefined();
});

it('rejects unknown versions and oversized output', () => {
  expect(readPresentation({ version: 2, source: 'root = Answer([Plan([0])])' }, 1)).toBeNull();
  expect(storePresentation('a'.repeat(4001), 1)).toBeUndefined();
  expect(storePresentation(null, 1)).toBeUndefined();
});

const result: CommandResult = {
  summary: 'Ein Plan.',
  warnings: ['Eine Seite fehlt.'],
  partial: true,
  sources: [],
  items: [
    {
      title: 'Ideen | sammeln',
      detail: 'Alle beteiligen.\nDanach abstimmen.',
      kind: 'fact',
      citation: { noteId: 'note', revision: 'r', title: 'Konzeption', page: 7, quote: 'Gemeinsam planen.' },
    },
    {
      title: 'Treffen planen',
      detail: 'Termin gemeinsam festlegen.',
      kind: 'proposal',
      url: 'https://example.com/plan',
    },
  ],
};
it('exports comparison tables with complete evidence, status and caveats as editable Markdown', () => {
  const text = commandResultMarkdown(result, [{ type: 'Comparison', items: [0, 1] }]);
  expect(text).toContain('| Ideen \\| sammeln | Alle beteiligen. Danach abstimmen. | Aus den Quellen |');
  expect(text).toContain('[Konzeption](notes/note), Seite 7');
  expect(text).toContain('> Gemeinsam planen.');
  expect(text).toContain('[Treffen planen](https://example.com/plan)');
  expect(text).toContain('Teilergebnis');
  expect(text).toContain('Eine Seite fehlt.');
  expect(itemTaskText(result.items[1])).toContain('- [ ] Treffen planen');
});
