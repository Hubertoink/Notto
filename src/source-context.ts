import { tagsOf, type AIContext, type Note } from './domain.js';
import { noteAllowed } from './evidence-policy.js';

export function defaultContext(note: Pick<Note, 'collections'>): AIContext {
  return note.collections?.length
    ? { mode: 'collection', collection: note.collections[0], web: false }
    : { mode: 'note', web: false };
}

/** Context selection narrows permissions; it can never grant access to excluded sources. */
export function contextNotes(
  notes: Note[],
  current: Note,
  context: AIContext,
  settings: { excludedNotes: string[]; excludedTags: string },
): Note[] {
  return notes.filter((note) => {
    if (note.scope !== current.scope || !noteAllowed(note, settings)) return false;
    if (note.id === current.id) return true;
    if (note.archived) return false;
    if (context.mode === 'note') return false;
    if (context.mode === 'collection') return note.collections?.includes(context.collection ?? '') ?? false;
    if (context.mode === 'selected')
      return (
        (context.sourceIds?.includes(note.id) ?? false) ||
        tagsOf(note.content).some((tag) => context.tags?.includes(tag))
      );
    return true;
  });
}
