// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from './domain';
const mock = vi.hoisted(() => ({ remote: new Map<string, Note>(), rpc: vi.fn(), uid: 'account-a' }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: mock.uid } }, error: null }) },
    rpc: mock.rpc,
    from: () => ({
      select: () => ({
        order: () => ({
          range: async () => ({
            data: [...mock.remote.values()].map((document) => ({ document })),
            error: null,
          }),
        }),
      }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));
import { db, repo } from './repository';
import { newNote, reviseNote } from './domain';
import { syncNotes } from './cloud';
beforeEach(async () => {
  localStorage.setItem(
    'notto-cloud',
    JSON.stringify({ url: 'https://example.supabase.co', key: 'test-public-key' }),
  );
  await db.notes.clear();
  mock.remote.clear();
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(
    async (
      _name: string,
      p: { p_id: string; p_revision: string; p_base_revision: string | null; p_document: Note },
    ) => {
      const old = mock.remote.get(p.p_id);
      if (old && old.revision !== p.p_base_revision && old.revision !== p.p_revision)
        return { data: { accepted: false, document: old }, error: null };
      mock.remote.set(p.p_id, p.p_document);
      return { data: { accepted: true }, error: null };
    },
  );
});
describe('synchronisation recovery', () => {
  it('keeps both originals when offline edits conflict', async () => {
    const original = newNote(mock.uid, 'Original');
    await repo.put(original, null);
    await syncNotes(mock.uid);
    const local = (await repo.get(mock.uid, original.id))!;
    await repo.put(reviseNote(local, { content: 'Lokale Fassung' }), local.revision);
    mock.remote.set(original.id, reviseNote(original, { content: 'Fassung vom anderen Gerät' }));
    expect(await syncNotes(mock.uid)).toBe(1);
    const notes = await repo.list(mock.uid);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.content).sort()).toEqual(['Fassung vom anderen Gerät', 'Lokale Fassung']);
    const copy = notes.find((n) => n.conflictOf)!;
    expect(copy.dirty).toBe(true);
    await syncNotes(mock.uid);
    expect(mock.remote.size).toBe(2);
  });
  it('does not clear a newer edit made while the upload was in flight', async () => {
    const n = newNote(mock.uid, 'Version beim Upload');
    await repo.put(n, null);
    mock.rpc.mockImplementationOnce(async (_name: string, p: { p_document: Note }) => {
      const current = (await repo.get(mock.uid, n.id))!;
      await repo.put(reviseNote(current, { content: 'Während Upload geändert' }), current.revision);
      mock.remote.set(n.id, p.p_document);
      return { data: { accepted: true }, error: null };
    });
    await syncNotes(mock.uid);
    const latest = (await repo.get(mock.uid, n.id))!;
    expect(latest.content).toBe('Während Upload geändert');
    expect(latest.dirty).toBe(true);
    expect(latest.baseRevision).toBe(n.revision);
    await syncNotes(mock.uid);
    expect(mock.remote.get(n.id)?.content).toBe('Während Upload geändert');
  });
  it('retries a successful upload whose response was lost without duplication', async () => {
    const n = newNote(mock.uid, 'Nicht duplizieren');
    await repo.put(n, null);
    mock.rpc.mockImplementationOnce(async (_name: string, p: { p_document: Note }) => {
      mock.remote.set(n.id, p.p_document);
      return { data: null, error: new Error('Verbindung abgebrochen') };
    });
    await expect(syncNotes(mock.uid)).rejects.toThrow('Verbindung abgebrochen');
    expect((await repo.get(mock.uid, n.id))?.dirty).toBe(true);
    await syncNotes(mock.uid);
    expect(await repo.list(mock.uid)).toHaveLength(1);
    expect((await repo.get(mock.uid, n.id))?.dirty).toBe(false);
  });
});
