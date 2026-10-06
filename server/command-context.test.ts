import { expect, it, vi } from 'vitest';
import { newNote } from '../src/domain';
import { commandContextSources } from './command-context';
import type { Database } from './database';

const settings = { excludedNotes: [], excludedTags: 'privat' };
function fixture(text: string) {
  const user = crypto.randomUUID();
  const current = { ...newNote(user, 'Konzeption Jugendhaus'), collections: ['Jugendhaus'] };
  const id = `${crypto.randomUUID()}.pdf`;
  const document = {
    ...newNote(user, `Konzeption #pädagogik\n[Konzeption](attachments/${id})`),
    collections: ['Jugendhaus'],
    document: { attachmentId: id, name: 'Konzeption.pdf', mime: 'application/pdf', version: 2 },
  };
  const extraction = {
    id: crypto.randomUUID(),
    scope: user,
    noteId: document.id,
    kind: 'extraction',
    at: '2026-10-06',
    data: {
      id,
      pages: [
        { noteId: document.id, revision: document.revision, attachment: id, page: 1, text },
        {
          noteId: document.id,
          revision: document.revision,
          attachment: id,
          page: 2,
          text: 'Jugendliche bestimmen das Programm gemeinsam.',
        },
      ],
    },
  };
  const notes = [current, document];
  const query = vi.fn(async (sql: string) => ({
    rows: (sql.includes('FROM notes') ? notes : [extraction]).map((document) => ({ document })),
  }));
  return { db: { query } as unknown as Database, user, current, document, notes, id };
}
it('includes every page of explicitly selected documents with page and version provenance', async () => {
  const f = fixture('A'.repeat(15000));
  const result = await commandContextSources(
    f.db,
    f.user,
    f.current,
    { mode: 'selected', sourceIds: [f.document.id] },
    settings,
    'Fasse vollständig zusammen',
  );
  expect(result.sources.find((source) => source.page === 1)?.text).toHaveLength(15000);
  expect(result.sources.find((source) => source.page === 2)).toMatchObject({
    attachment: f.id,
    title: 'Konzeption · Version 2',
    text: 'Jugendliche bestimmen das Programm gemeinsam.',
  });
});
it('reports unreadable pages and rejects excluded explicit sources and oversized full reads', async () => {
  const f = fixture('[Kein Text erkannt. OCR erforderlich.]');
  const result = await commandContextSources(
    f.db,
    f.user,
    f.current,
    { mode: 'selected', sourceIds: [f.document.id] },
    settings,
    'Fasse zusammen',
  );
  expect(result.warnings.join(' ')).toContain('Seite 1');
  expect(result.sources.some((source) => source.text.startsWith('[Kein Text erkannt.'))).toBe(false);
  await expect(
    commandContextSources(
      f.db,
      f.user,
      f.current,
      { mode: 'selected', sourceIds: [f.document.id] },
      { ...settings, excludedNotes: [f.document.id] },
      'Frage',
    ),
  ).rejects.toThrow('ausgeschlossen');
  const large = fixture('X'.repeat(120001));
  await expect(
    commandContextSources(
      large.db,
      large.user,
      large.current,
      { mode: 'selected', sourceIds: [large.document.id] },
      settings,
      'Fasse zusammen',
    ),
  ).rejects.toThrow('120.000');
});

it('uses collection documents for generic requests using the current note as context', async () => {
  const f = fixture('Offener Treff und Konzeption Jugendhaus');
  const result = await commandContextSources(
    f.db,
    f.user,
    f.current,
    { mode: 'collection', collection: 'Jugendhaus' },
    settings,
    'Fasse das für diese Notiz zusammen',
  );
  expect(
    result.sources.some((source) => source.attachment === f.id && source.text.includes('Offener Treff')),
  ).toBe(true);
  expect(result.sources.some((source) => source.noteId === f.document.id && !source.attachment)).toBe(false);
  const narrowed = await commandContextSources(
    f.db,
    f.user,
    f.current,
    { mode: 'note', sourceIds: [f.document.id] },
    settings,
    'Nur die Notiz',
  );
  expect(narrowed.sources.some((source) => source.noteId === f.document.id)).toBe(false);
});
