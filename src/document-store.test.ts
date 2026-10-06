// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, repo } from './repository';
import { createDocument, documentPages, replaceDocument } from './document-store';
import { buildExport } from './export';
import { allAttachmentIds, tagsOf, titleOf } from './domain';
import { unzipSync, strFromU8 } from 'fflate';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./cloud', () => ({
  fetchAttachment: (scope: string, id: string) => repo.attachment(scope, id),
  cloud: () => null,
  ownBackend: () => false,
}));
beforeEach(async () => {
  localStorage.clear();
  await Promise.all([db.notes.clear(), db.attachments.clear(), db.knowledge.clear(), db.drafts.clear()]);
});
const file = (name: string, text: string) =>
  ({
    name,
    size: new TextEncoder().encode(text).length,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
it('keeps source identity, tags, collection and previous files when replacing a document and exporting', async () => {
  const original = await repo.addDocument(
    'local',
    file('Konzeption.txt', 'Jugendliche bestimmen das Programm gemeinsam.'),
  );
  const document = await createDocument('local', original, ['Jugendhaus'], ['konzeption']);
  expect((await documentPages(document))[0].text).toContain('Jugendliche');
  const replaced = await replaceDocument(
    document,
    file('Konzeption-2026.md', '# Neue Fassung\nDer Jugendrat entscheidet mit.'),
  );
  expect(replaced.id).toBe(document.id);
  expect(replaced.document?.version).toBe(2);
  expect(replaced.collections).toEqual(['Jugendhaus']);
  expect(tagsOf(replaced.content)).toEqual(['konzeption']);
  expect(titleOf(replaced.content)).toBe('Konzeption.txt');
  expect(allAttachmentIds(replaced)).toContain(original.id);
  expect((await documentPages(replaced))[0].text).toContain('Jugendrat');
  const exported = unzipSync(await buildExport('local'));
  expect(strFromU8(exported[`attachments/${original.id}`])).toContain('Jugendliche');
  expect(strFromU8(exported[`attachments/${replaced.document!.attachmentId}`])).toContain('Jugendrat');
  expect(JSON.parse(strFromU8(exported['notto-backup.json'])).notes[0].document.version).toBe(2);
});
