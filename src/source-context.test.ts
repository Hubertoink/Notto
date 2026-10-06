import { expect, it } from 'vitest';
import { newNote, validNote } from './domain';
import { contextNotes, defaultContext, commandSourceContext, webResearchEnabled } from './source-context';
const settings = { excludedNotes: [], excludedTags: 'privat' };
it('inherits web research for new notes and legacy notes, with deliberate note and notebook opt-outs', () => {
  for (const context of [
    undefined,
    { mode: 'note' as const, web: false },
    { mode: 'note' as const, web: true },
  ]) {
    const note = { ...newNote('alice', 'Ownership'), aiContext: context };
    expect(commandSourceContext(note, {}).web).toBe(true);
    expect(commandSourceContext(note, { commandWeb: false }).web).toBe(false);
  }
  const optedOut = { mode: 'note' as const, webPolicy: 'off' as const };
  expect(webResearchEnabled(optedOut)).toBe(false);
  expect(webResearchEnabled({ ...optedOut, webPolicy: 'inherit' })).toBe(true);
  const selected = {
    mode: 'selected' as const,
    sourceIds: [crypto.randomUUID()],
    tags: ['jugendarbeit'],
    web: false,
  };
  expect(commandSourceContext({ aiContext: selected }, {})).toEqual({ ...selected, web: true });
  expect(validNote({ ...newNote('alice', 'Ownership'), aiContext: optedOut })).toBe(true);
  expect(
    validNote({ ...newNote('alice', 'Ownership'), aiContext: { ...optedOut, webPolicy: 'invalid' } }),
  ).toBe(false);
});
it('selects collection and tagged sources while enforcing account and privacy boundaries', () => {
  const current = { ...newNote('alice', 'Planung'), collections: ['Jugendhaus'] };
  const document = { ...newNote('alice', 'Konzeption #pädagogik'), collections: ['Jugendhaus'] };
  const privateNote = { ...newNote('alice', 'Personal #privat'), collections: ['Jugendhaus'] };
  const foreign = { ...newNote('bob', 'Konzeption'), collections: ['Jugendhaus'] };
  const unrelated = newNote('alice', 'Andere Organisation');
  const archived = { ...document, id: crypto.randomUUID(), archived: true };
  const notes = [current, document, privateNote, foreign, unrelated, archived];
  expect(contextNotes(notes, current, defaultContext(current), settings)).toEqual([current, document]);
  expect(
    contextNotes(
      notes,
      current,
      { mode: 'selected', tags: ['pädagogik'], sourceIds: [privateNote.id, foreign.id] },
      settings,
    ),
  ).toEqual([current, document]);
  expect(contextNotes(notes, current, { mode: 'note' }, settings)).toEqual([current]);
});
it('validates persisted source selections and standalone document records', () => {
  const id = `${crypto.randomUUID()}.docx`;
  const source = {
    ...newNote('alice', `[Konzeption](attachments/${id})`),
    document: {
      attachmentId: id,
      name: 'Konzeption.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      version: 1,
    },
    aiContext: { mode: 'selected', sourceIds: [crypto.randomUUID()], web: false },
  };
  expect(validNote(source)).toBe(true);
  expect(validNote({ ...source, aiContext: { mode: 'selected', sourceIds: ['../../foreign'] } })).toBe(false);
  expect(validNote({ ...source, document: { ...source.document, attachmentId: '../../source.docx' } })).toBe(
    false,
  );
  expect(validNote({ ...source, aiContext: { mode: 'collection' } })).toBe(false);
});
