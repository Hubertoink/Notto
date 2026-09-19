// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { db, repo } from './repository';
import { buildExport } from './export';
import { newNote, reviseNote } from './domain';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(async () => {
  localStorage.clear();
  await db.notes.clear();
  await db.drafts.clear();
  await db.attachments.clear();
});
it('exports image attachments from unsaved drafts as well as historical versions', async () => {
  const a = {
    scope: 'local',
    id: 'abc-123.png',
    name: 'Bild',
    mime: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  };
  const b = { ...a, id: 'abc-456.png' };
  await repo.putAttachment(a);
  await repo.putAttachment(b);
  const original = newNote('local', '![Altes Bild](attachments/abc-123.png)');
  const note = reviseNote(original, { content: 'Bild im aktuellen Text entfernt' });
  await repo.put(note, null);
  await repo.saveDraft({
    key: 'local:new',
    scope: 'local',
    noteId: null,
    baseRevision: null,
    content: '![Entwurf](attachments/abc-456.png)',
    updatedAt: new Date().toISOString(),
  });
  const files = unzipSync(await buildExport('local'));
  expect(files['attachments/abc-123.png']).toEqual(a.bytes);
  expect(files['attachments/abc-456.png']).toEqual(b.bytes);
  expect(strFromU8(files['draft-1.md'])).toContain('Entwurf');
  expect(JSON.parse(strFromU8(files['notto-backup.json'])).notes[0].history).toHaveLength(2);
});
it('fails instead of producing an incomplete backup when an attachment is missing', async () => {
  await repo.put(newNote('local', '![Fehlt](attachments/abc-123.png)'), null);
  await expect(buildExport('local')).rejects.toThrow('Export unvollständig');
});
