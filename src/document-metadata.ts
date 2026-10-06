import { reviseNote, tagsOf, type Note } from './domain';
import { documentMetadataContent } from './document-content';
import { mutateStored, repo } from './repository';
import { normalizeCollections } from './note-tools';
import { createCollection } from './collections';

export type DocumentMetadataChange =
  { title: string } | { kind: 'tags' | 'collections'; before: string[]; after: string[] };
/** Combine failed edits with the next edit so later removals win over earlier additions. */
export function mergeDocumentMetadataChanges(changes: DocumentMetadataChange[]): DocumentMetadataChange {
  const last = changes.at(-1)!;
  if ('title' in last) return last;
  const additions = new Map<string, string>(),
    removals = new Map<string, string>();
  const key = (name: string) => name.toLocaleLowerCase('de');
  for (const change of changes) {
    if (!('kind' in change) || change.kind !== last.kind) continue;
    for (const name of change.before.filter(
      (name) => !change.after.some((value) => key(value) === key(name)),
    )) {
      additions.delete(key(name));
      removals.set(key(name), name);
    }
    for (const name of change.after.filter(
      (name) => !change.before.some((value) => key(value) === key(name)),
    )) {
      removals.delete(key(name));
      additions.set(key(name), name);
    }
  }
  return { kind: last.kind, before: [...removals.values()], after: [...additions.values()] };
}
export async function updateDocumentMetadata(
  owner: Pick<Note, 'scope' | 'id'>,
  change: DocumentMetadataChange,
) {
  if ('title' in change && !change.title.trim()) throw new Error('Der Titel darf nicht leer sein.');
  const key = (name: string) => name.toLocaleLowerCase('de');
  if ('kind' in change && change.kind === 'collections')
    for (const name of change.after.filter(
      (name) => !change.before.some((value) => key(value) === key(name)),
    ))
      await createCollection(owner.scope, name);
  let found = false;
  await mutateStored(owner.scope, owner.id, (current) => {
    if (!current.document || current.deleted) throw new Error('Das Dokument ist nicht mehr verfügbar.');
    found = true;
    if ('title' in change)
      return reviseNote(current, { content: documentMetadataContent(current, change.title) });
    const added = change.after.filter((name) => !change.before.some((value) => key(value) === key(name)));
    const removed = change.before.filter((name) => !change.after.some((value) => key(value) === key(name)));
    const existing = change.kind === 'tags' ? tagsOf(current.content) : (current.collections ?? []);
    const values = [
      ...new Set([
        ...existing.filter((name) => !removed.some((value) => key(value) === key(name))),
        ...added,
      ]),
    ];
    return reviseNote(
      current,
      change.kind === 'tags'
        ? { content: documentMetadataContent(current, undefined, values) }
        : { collections: normalizeCollections(values) },
    );
  });
  if (!found) throw new Error('Das Dokument ist nicht mehr verfügbar.');
  return repo.get(owner.scope, owner.id);
}
