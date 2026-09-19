// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
import { db, repo } from './repository';
import { newNote, reviseNote } from './domain';
beforeEach(async () => {
  await db.notes.clear();
  await db.drafts.clear();
  await db.attachments.clear();
});
describe('local persistence', () => {
  it('isolates local notes and different accounts', async () => {
    const a = newNote('local', 'Privat');
    const b = newNote('account-b', 'Konto');
    await repo.put(a, null);
    await repo.put(b, null);
    expect((await repo.list('local')).map((n) => n.content)).toEqual(['Privat']);
    expect(await repo.get('account-b', a.id)).toBeUndefined();
  });
  it('rejects stale writes from a second window', async () => {
    const original = newNote('local', 'A');
    await repo.put(original, null);
    const first = reviseNote(original, { content: 'B' });
    const second = reviseNote(original, { content: 'C' });
    await repo.put(first, original.revision);
    await expect(repo.put(second, original.revision)).rejects.toThrow('anderen Fenster');
    expect((await repo.get('local', original.id))?.content).toBe('B');
  });
  it('persists an unsaved draft independently of the original', async () => {
    const note = newNote('local', 'Original');
    await repo.put(note, null);
    await repo.saveDraft({
      key: `local:${note.id}`,
      scope: 'local',
      noteId: note.id,
      content: 'Noch nicht fertig',
      baseRevision: note.revision,
      updatedAt: new Date().toISOString(),
    });
    expect((await repo.draft('local', note.id))?.content).toBe('Noch nicht fertig');
    expect((await repo.get('local', note.id))?.content).toBe('Original');
    expect(await repo.draft('account-b', note.id)).toBeUndefined();
  });
});
