import Dexie, { type Table } from 'dexie';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import {
  type Attachment,
  type Draft,
  type Note,
  type Scope,
  imageExtensions,
  MAX_IMAGE_BYTES,
} from './domain';

export const desktop = isTauri();
class NottoDatabase extends Dexie {
  notes!: Table<Note, [string, string]>;
  drafts!: Table<Draft, string>;
  attachments!: Table<Attachment, [string, string]>;
  knowledge!: Table<import('./intelligence').KnowledgeRecord, [string, string]>;
  constructor() {
    super('notto-v1');
    this.version(1).stores({
      notes: '[scope+id],scope,updatedAt',
      drafts: 'key,scope',
      attachments: '[scope+id],scope',
    });
    this.version(2).stores({ knowledge: '[scope+id],scope' });
  }
}
export const db = new NottoDatabase();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('notto-changes') : null;
export function announce() {
  window.dispatchEvent(new Event('notto-change'));
  channel?.postMessage('change');
  if (desktop) void emit('notto-change').catch(console.error);
}
channel?.addEventListener('message', () => window.dispatchEvent(new Event('notto-change')));
export const repo = {
  async list(scope: Scope): Promise<Note[]> {
    return desktop ? invoke('list_notes', { scope }) : db.notes.where('scope').equals(scope).toArray();
  },
  async get(scope: Scope, id: string): Promise<Note | undefined> {
    return desktop
      ? ((await invoke<Note | null>('get_note', { scope, id })) ?? undefined)
      : db.notes.get([scope, id]);
  },
  async put(note: Note, expectedRevision: string | null): Promise<void> {
    if (desktop) await invoke('put_note', { note, expectedRevision });
    else
      await db.transaction('rw', db.notes, async () => {
        const old = await db.notes.get([note.scope, note.id]);
        if ((old?.revision ?? null) !== expectedRevision)
          throw new Error(
            'Diese Notiz wurde in einem anderen Fenster geändert. Dein Entwurf bleibt erhalten.',
          );
        await db.notes.put(note);
      });
    announce();
  },
  async draft(scope: Scope, noteId: string | null): Promise<Draft | undefined> {
    const key = `${scope}:${noteId ?? 'new'}`;
    return desktop ? ((await invoke<Draft | null>('get_draft', { key })) ?? undefined) : db.drafts.get(key);
  },
  async drafts(scope: Scope): Promise<Draft[]> {
    return desktop ? invoke('list_drafts', { scope }) : db.drafts.where('scope').equals(scope).toArray();
  },
  async saveDraft(draft: Draft): Promise<void> {
    if (desktop) await invoke('save_draft', { draft });
    else await db.drafts.put(draft);
  },
  async removeDraft(scope: Scope, noteId: string | null): Promise<void> {
    const key = `${scope}:${noteId ?? 'new'}`;
    if (desktop) await invoke('remove_draft', { key });
    else await db.drafts.delete(key);
  },
  async attachment(scope: Scope, id: string): Promise<Attachment | undefined> {
    if (!desktop) return db.attachments.get([scope, id]);
    const a = await invoke<(Omit<Attachment, 'bytes'> & { bytes: number[] }) | null>('get_attachment', {
      scope,
      id,
    });
    return a ? { ...a, bytes: new Uint8Array(a.bytes) } : undefined;
  },
  async putAttachment(a: Attachment): Promise<void> {
    if (desktop) await invoke('put_attachment', { attachment: { ...a, bytes: Array.from(a.bytes) } });
    else await db.attachments.put(a);
  },
  async addImage(scope: Scope, file: File): Promise<string> {
    const extension = imageExtensions[file.type];
    if (!extension) throw new Error('Bitte ein PNG-, JPG-, WebP-, GIF- oder AVIF-Bild auswählen.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Ein Bild darf höchstens 12 MB groß sein.');
    const id = `${crypto.randomUUID()}.${extension}`;
    await this.putAttachment({
      scope,
      id,
      name: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return `![${file.name.replace(/[\[\]\\\n]/g, '')}](attachments/${id})`;
  },
  async addPdf(scope: Scope, file: File): Promise<string> {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Ein PDF darf höchstens 12 MB groß sein.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new Error('Die Datei ist kein gültiges PDF.');
    const id = `${crypto.randomUUID()}.pdf`;
    await this.putAttachment({ scope, id, name: file.name, mime: 'application/pdf', bytes });
    return `[${file.name.replace(/[\[\]\\\n]/g, '')}](attachments/${id})`;
  },
};

export async function mutateStored(scope: Scope, id: string, fn: (n: Note) => Note): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await repo.get(scope, id);
    if (!current) return;
    try {
      await repo.put(fn(current), current.revision);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}
