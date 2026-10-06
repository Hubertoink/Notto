import { tagsOf, type AIContext, type Note } from './domain.js';
import { noteAllowed } from './evidence-policy.js';

export function defaultContext(note: Pick<Note, 'collections'>): AIContext {
  return note.collections?.length
    ? { mode: 'collection', collection: note.collections[0] }
    : { mode: 'note' };
}

export function webResearchEnabled(context: AIContext, settings: { commandWeb?: boolean } = {}) {
  // Version 1.5.0–1.5.2 saved web:false by default, indistinguishable from a user choice.
  // Existing notes now inherit the notebook setting; new deliberate opt-outs use webPolicy.
  return settings.commandWeb !== false && context.webPolicy !== 'off';
}

export function commandSourceContext(
  note: Pick<Note, 'collections' | 'aiContext'>,
  settings: { commandWeb?: boolean },
): AIContext {
  const context = note.aiContext ?? defaultContext(note);
  return { ...context, web: webResearchEnabled(context, settings) };
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
