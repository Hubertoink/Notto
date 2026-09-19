import { expect, it } from 'vitest';
import { memoryContext, memoryState, type Memory, type MemoryRecord } from './memory-policy';

const note = {
  id: 'note',
  scope: 'alice',
  revision: 'v1',
  content: '#arbeit Vier PCs im Medienraum',
  deleted: false,
};
const settings = { excludedNotes: [] as string[], excludedTags: '' };
const entry: Memory = {
  key: 'fact',
  category: 'fact',
  text: 'Kontext für vier PCs',
  status: 'active',
  sources: [{ noteId: note.id, revision: note.revision, quote: 'Vier PCs' }],
};
const record = (
  data: unknown,
  kind = 'memory',
  at = '2026-01-01',
  id: string = crypto.randomUUID(),
): MemoryRecord => ({ id, scope: 'alice', noteId: 'note', revision: 'v1', kind, at, data });
const context = (records: MemoryRecord[], notes = [note], config = settings) =>
  memoryContext(records, notes, config, 'alice', 'Medienraum');

it('uses confirmed current sources only and isolates accounts', () => {
  expect(context([record(entry)])).toContain(entry.text);
  expect(context([{ ...record(entry), scope: 'bob' }])).toBe('');
  expect(context([record({ ...entry, status: 'suggested' })])).toBe('');
  expect(context([record(entry)], [{ ...note, revision: 'v2' }])).toBe('');
  expect(context([record(entry)], [{ ...note, deleted: true }])).toBe('');
  expect(context([record(entry)], [{ ...note, content: 'Andere Inhalte' }])).toBe('');
  expect(context([record(entry)], [note], { ...settings, excludedNotes: ['note'] })).toBe('');
  expect(context([record(entry)], [note], { ...settings, excludedTags: '#arbeit' })).toBe('');
});
it('applies edits, forgetting and the notebook pause switch to future requests', () => {
  const old = record(entry);
  const edited = record({ ...entry, text: 'Neuer Kontext' }, 'memory', '2026-01-02');
  expect(context([old, edited])).toContain('Neuer Kontext');
  expect(context([old, edited])).not.toContain(entry.text);
  expect(context([old, record({ ...entry, status: 'forgotten' }, 'memory', '2026-01-03')])).toBe('');
  expect(
    context([old, record({ ...entry, key: 'memory-settings', category: 'settings', enabled: false })]),
  ).toBe('');
});
const suggestion = { kind: 'task', title: 'PCs kaufen', detail: 'Vier Geräte', quote: 'Vier PCs' };
const analysis = record({ suggestions: [suggestion] }, 'analysis');
const decision = {
  key: 'note:task:vier pcs',
  status: 'accepted',
  title: 'PCs einrichten',
  detail: 'Vorhandene Geräte verwenden',
};
const corrected = record(decision, 'decision', '2026-01-02', 'correction-id');
it('learns only explicit corrections with review by default and optional automatic use', () => {
  const records = [analysis, corrected];
  expect(memoryState(records, 'alice').entries[0].status).toBe('suggested');
  expect(context(records)).toBe('');
  const auto = record({ ...entry, key: 'memory-settings', category: 'settings', autoLearn: true });
  expect(context([...records, auto])).toContain('Vorhandene Geräte verwenden');
  expect(
    memoryState(
      [analysis, record({ ...decision, title: suggestion.title, detail: suggestion.detail }, 'decision')],
      'alice',
    ).entries,
  ).toEqual([]);
  expect(
    memoryState([analysis, record({ ...decision, status: 'done' }, 'decision')], 'alice').entries,
  ).toEqual([]);
});
it('does not resurrect forgotten corrections or use superseded accepted preferences', () => {
  const learned = memoryState([analysis, corrected], 'alice').entries[0];
  const accepted = record({ ...learned, status: 'active' }, 'memory', '2026-01-03');
  expect(context([analysis, corrected, accepted])).toContain(decision.detail);
  expect(
    context([
      analysis,
      corrected,
      accepted,
      record({ ...decision, status: 'rejected' }, 'decision', '2026-01-04'),
    ]),
  ).toBe('');
  expect(
    context([
      analysis,
      corrected,
      accepted,
      record({ ...decision, detail: 'Anders' }, 'decision', '2026-01-04'),
    ]),
  ).toBe('');
  expect(
    memoryState([analysis, corrected, record({ ...learned, status: 'forgotten' })], 'alice').entries,
  ).toEqual([]);
});
