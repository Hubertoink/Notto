// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, repo } from './repository';
import { knowledge } from './intelligence';
import { newNote } from './domain';
import { addNoteToCollection, collectionNames, createCollection } from './collections';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(async () => {
  await db.notes.clear();
  await db.knowledge.clear();
});

it('persists empty collections separately from notes and keeps accounts separate', async () => {
  await createCollection('alice', ' Jugendhaus ');
  await createCollection('alice', 'jugendhaus');
  await createCollection('bob', 'Privat');
  const records = await knowledge.list('alice');
  expect(records).toHaveLength(1);
  expect(collectionNames([], records, 'alice')).toEqual(['Jugendhaus']);
  expect(collectionNames([], records, 'bob')).toEqual([]);
});

it('adding a dragged note preserves text, history and existing collection memberships', async () => {
  const note = { ...newNote('alice', 'Originaltext'), collections: ['Konzeption'] };
  await repo.put(note, null);
  await addNoteToCollection('alice', note.id, 'Jugendhaus');
  const result = await repo.get('alice', note.id);
  expect(result?.collections).toEqual(['Konzeption', 'Jugendhaus']);
  expect(result?.content).toBe(note.content);
  expect(result?.history).toEqual(note.history);
  await addNoteToCollection('alice', note.id, 'Jugendhaus');
  expect((await repo.get('alice', note.id))?.collections).toEqual(['Konzeption', 'Jugendhaus']);
});
