export type Scope = string;
export interface Revision {
  revision: string;
  content: string;
  savedAt: string;
}
export interface Note {
  id: string;
  scope: Scope;
  content: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
  baseRevision: string | null;
  dirty: boolean;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  conflictOf?: string;
  history: Revision[];
}
export interface Draft {
  key: string;
  scope: Scope;
  noteId: string | null;
  content: string;
  baseRevision: string | null;
  updatedAt: string;
}
export interface Attachment {
  id: string;
  scope: Scope;
  name: string;
  mime: string;
  bytes: Uint8Array;
}
export const LOCAL_SCOPE = 'local';
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
export function tagsOf(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  return [
    ...new Set(
      [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu)].map((m) =>
        m[1].toLocaleLowerCase('de'),
      ),
    ),
  ];
}
export function titleOf(content: string): string {
  return (
    content
      .split('\n')
      .map((s) =>
        s
          .replace(/^#{1,6}\s+/, '')
          .replace(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu, ' ')
          .trim(),
      )
      .find((s) => s && !s.startsWith('!['))
      ?.slice(0, 110) || 'Unbenannte Notiz'
  );
}
export function excerptOf(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[Bild]')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function newNote(scope: Scope, content: string, now = new Date().toISOString()): Note {
  const revision = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    scope,
    content,
    createdAt: now,
    updatedAt: now,
    revision,
    baseRevision: null,
    dirty: true,
    pinned: false,
    archived: false,
    deleted: false,
    history: [{ revision, content, savedAt: now }],
  };
}
export function reviseNote(
  note: Note,
  patch: Partial<Pick<Note, 'content' | 'pinned' | 'archived' | 'deleted'>>,
  now = new Date().toISOString(),
): Note {
  const revision = crypto.randomUUID();
  const content = patch.content ?? note.content;
  return {
    ...note,
    ...patch,
    updatedAt: now,
    revision,
    dirty: true,
    history: content !== note.content ? [...note.history, { revision, content, savedAt: now }] : note.history,
  };
}
export function conflictCopy(note: Note): Note {
  return {
    ...note,
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    baseRevision: null,
    dirty: true,
    deleted: false,
    conflictOf: note.id,
    updatedAt: new Date().toISOString(),
  };
}
export function attachmentIds(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/attachments\/([a-f0-9-]+\.(?:png|jpg|webp|gif|avif|pdf))/g)].map((m) => m[1]),
    ),
  ];
}
export function allAttachmentIds(note: Note): string[] {
  return [...new Set([note.content, ...note.history.map((r) => r.content)].flatMap(attachmentIds))];
}
export function markdownFile(note: Note): string {
  return `---\nnotto_id: ${note.id}\ncreated: ${note.createdAt}\nupdated: ${note.updatedAt}\ntags: ${JSON.stringify(tagsOf(note.content))}\npinned: ${note.pinned}\narchived: ${note.archived}\n---\n\n${note.content}`;
}
export function importedMarkdown(text: string): string {
  if (!/^---\r?\nnotto_id: /.test(text)) return text;
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/, '');
}
export function matchesQuery(note: Note, query: string): boolean {
  const tokens = query.toLocaleLowerCase('de').match(/"[^"]+"|\S+/g) || [];
  const content = note.content.toLocaleLowerCase('de');
  const tags = tagsOf(note.content);
  return tokens.every((t) =>
    t.startsWith('#') ? tags.includes(t.slice(1)) : content.includes(t.replace(/^"|"$/g, '')),
  );
}
export function validNote(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const n = value as Note;
  return (
    typeof n.id === 'string' &&
    /^[a-f0-9-]{36}$/.test(n.id) &&
    typeof n.content === 'string' &&
    typeof n.revision === 'string' &&
    typeof n.pinned === 'boolean' &&
    typeof n.archived === 'boolean' &&
    typeof n.deleted === 'boolean' &&
    Array.isArray(n.history) &&
    n.history.length > 0 &&
    n.history.every(
      (r) =>
        r &&
        typeof r.content === 'string' &&
        typeof r.savedAt === 'string' &&
        Number.isFinite(Date.parse(r.savedAt)) &&
        typeof r.revision === 'string',
    ) &&
    typeof n.createdAt === 'string' &&
    typeof n.updatedAt === 'string' &&
    Number.isFinite(Date.parse(n.createdAt)) &&
    Number.isFinite(Date.parse(n.updatedAt))
  );
}
