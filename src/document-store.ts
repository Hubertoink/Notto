import { newNote, reviseNote, tagsOf, titleOf, type Attachment, type Note } from './domain';
import { repo } from './repository';
import { extract, knowledge, type Evidence } from './intelligence';

export const safeLabel = (value: string) => value.replace(/[\[\]\\\r\n]/g, '').trim();
export function documentContent(title: string, tags: string[], attachment: Pick<Attachment, 'id' | 'name'>) {
  return `${safeLabel(title) || safeLabel(attachment.name)}\n\n${tags.map((tag) => `#${tag}`).join(' ')}\n\n[${safeLabel(attachment.name)}](attachments/${attachment.id})`;
}
export async function createDocument(
  scope: string,
  attachment: Attachment,
  collections: string[] = [],
  tags: string[] = [],
) {
  const note: Note = {
    ...newNote(scope, documentContent(attachment.name, tags, attachment)),
    collections,
    document: { attachmentId: attachment.id, name: attachment.name, mime: attachment.mime, version: 1 },
  };
  await repo.put(note, null);
  return note;
}
export async function replaceDocument(note: Note, file: File) {
  if (!note.document) throw new Error('Kein Bibliotheksdokument.');
  const attachment = await repo.addDocument(note.scope, file);
  const updated = reviseNote(note, {
    content: documentContent(titleOf(note.content), tagsOf(note.content), attachment),
    document: {
      attachmentId: attachment.id,
      name: attachment.name,
      mime: attachment.mime,
      version: note.document.version + 1,
    },
  });
  await repo.put(updated, note.revision);
  return updated;
}
export async function documentPages(note: Note): Promise<Evidence[]> {
  if (!note.document) return [];
  const records = await knowledge.list(note.scope);
  let record = records
    .filter(
      (record) =>
        record.noteId === note.id &&
        record.kind === 'extraction' &&
        (record.data as { id: string }).id === note.document!.attachmentId,
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!record) {
    await extract(note, note.document.attachmentId);
    record = (await knowledge.list(note.scope))
      .filter(
        (record) =>
          record.noteId === note.id &&
          record.kind === 'extraction' &&
          (record.data as { id: string }).id === note.document!.attachmentId,
      )
      .sort((a, b) => b.at.localeCompare(a.at))[0];
  }
  return (record?.data as { pages?: Evidence[] })?.pages ?? [];
}
