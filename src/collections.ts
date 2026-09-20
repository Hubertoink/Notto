import type { Note } from './domain';
import { knowledge, type KnowledgeRecord } from './intelligence';
import { normalizeCollections } from './note-tools';
import { mutateStored } from './repository';
import { reviseNote } from './domain';

export const NOTE_DRAG_TYPE = 'application/x-noto-note';

export function collectionNames(notes: Note[], records: KnowledgeRecord[], scope: string): string[] {
  const names = records
    .filter((r) => r.scope === scope && r.kind === 'collection')
    .flatMap((r) => {
      const name = (r.data as { name?: unknown })?.name;
      return typeof name === 'string' && name.trim() && name.length <= 60 ? [name] : [];
    });
  names.push(...notes.filter((n) => n.scope === scope && !n.deleted).flatMap((n) => n.collections || []));
  // Each collection can exist before it contains any notes.
  const unique = new Map<string, string>();
  for (const name of names)
    if (!unique.has(name.toLocaleLowerCase('de'))) unique.set(name.toLocaleLowerCase('de'), name);
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

export async function createCollection(scope: string, value: string): Promise<string> {
  const name = normalizeCollections([value])[0];
  if (!name) throw new Error('Gib einen Namen für die Sammlung ein.');
  const existing = collectionNames([], await knowledge.list(scope), scope).find(
    (c) => c.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
  );
  if (existing) return existing;
  await knowledge.append({ scope, id: crypto.randomUUID(), revision: crypto.randomUUID() }, 'collection', {
    name,
  });
  return name;
}

export async function addNoteToCollection(scope: string, id: string, name: string) {
  await mutateStored(scope, id, (note) => {
    if (note.deleted) throw new Error('Notizen im Papierkorb zuerst wiederherstellen.');
    const collections = normalizeCollections([...(note.collections || []), name]);
    if (!collections.some((c) => c.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')))
      throw new Error('Eine Notiz kann höchstens 30 Sammlungen angehören.');
    return reviseNote(note, { collections });
  });
}
