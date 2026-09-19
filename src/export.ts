import { zipSync, strToU8 } from 'fflate';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { allAttachmentIds, markdownFile, type Scope } from './domain';
import { repo, desktop } from './repository';
import { fetchAttachment } from './cloud';
export async function exportNotebook(scope: Scope) {
  const notes = await repo.list(scope);
  const drafts = await repo.drafts(scope);
  const files: Record<string, Uint8Array> = {};
  for (const note of notes) {
    files[`${note.deleted ? 'trash/' : ''}${note.id}.md`] = strToU8(markdownFile(note));
  }
  const ids = [...new Set(notes.flatMap(allAttachmentIds))];
  for (const id of ids) {
    const a = await fetchAttachment(scope, id);
    if (!a) throw new Error('Export unvollständig: Ein Bild fehlt. Bitte zuerst synchronisieren.');
    files[`attachments/${id}`] = a.bytes;
    files[`trash/attachments/${id}`] = a.bytes;
  }
  files['notto-backup.json'] = strToU8(
    JSON.stringify(
      { format: 'notto', version: 1, exportedAt: new Date().toISOString(), notes, drafts },
      null,
      2,
    ),
  );
  files['README.txt'] = strToU8(
    'Notto-Export\nDie Markdown-Dateien enthalten deine Originalnotizen.\nnotto-backup.json enthält zusätzlich die Versionshistorie, Zustände und Entwürfe.\nGelöschte Notizen liegen im Ordner trash.\n',
  );
  const bytes = zipSync(files);
  const filename = `notto-${new Date().toISOString().slice(0, 10)}.zip`;
  if (desktop) {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'Notto-Backup', extensions: ['zip'] }],
    });
    if (path) await invoke('write_export', { path, bytes: Array.from(bytes) });
    return Boolean(path);
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
