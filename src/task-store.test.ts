// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, repo } from './repository';
import { newNote } from './domain';
import { knowledge, evidence, type KnowledgeRecord } from './intelligence';
import { addTask, checkTask, tasksFor } from './task-store';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(async () => {
  await db.knowledge.clear();
  await db.notes.clear();
});
it('excludes command instructions from local analysis and old AI task suggestions', async () => {
  const note = newNote('local', 'Gedanken\n/ki Suche Rezensionen');
  expect((await evidence(note, []))[0].text).toBe('Gedanken\n');
  await knowledge.append(note, 'analysis', {
    suggestions: [{ kind: 'task', title: 'Rezensionen suchen', detail: '', quote: '/ki Suche Rezensionen' }],
  });
  expect(tasksFor([note], await knowledge.list('local'), 'local')).toEqual([]);
});
it('persists manual tasks independently and isolates notebooks', async () => {
  await addTask('local', '  Einkauf  ');
  const records = await knowledge.list('local');
  const task = tasksFor([], records, 'local')[0];
  expect(task.title).toBe('Einkauf');
  expect(tasksFor([], records, 'another')).toEqual([]);
  await checkTask('local', task, true);
  expect(tasksFor([], await knowledge.list('local'), 'local')[0].done).toBe(true);
  expect(await repo.list('local')).toEqual([]);
});
it('keeps AI completion across reanalysis without modifying the original', async () => {
  const note = newNote('local', 'Steam einrichten');
  await repo.put(note, null);
  const item = { kind: 'task', title: 'Steam einrichten', detail: 'Vier PCs', quote: note.content };
  await knowledge.append(note, 'analysis', { suggestions: [item] });
  const task = tasksFor([note], await knowledge.list('local'), 'local')[0];
  await checkTask('local', task, true);
  const records = await knowledge.list('local');
  records.push({
    id: 'newest',
    scope: 'local',
    noteId: note.id,
    revision: note.revision,
    kind: 'analysis',
    at: '2099-01-01T00:00:00.000Z',
    data: { suggestions: [] },
  } as KnowledgeRecord);
  expect(tasksFor([note], records, 'local')[0].done).toBe(true);
  expect(tasksFor([{ ...note, deleted: true }], records, 'local')).toEqual([]);
  expect(await repo.get('local', note.id)).toEqual(note);
});
