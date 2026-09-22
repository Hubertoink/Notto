import { knowledge, eligible, structured, config } from './intelligence';
import { repo } from './repository';
import { contentRevision, type Note } from './domain';
import {
  candidateInstructions,
  candidateResponse,
  relationInstructions,
  relationResponse,
  discoverRelations,
  validRelation,
  type RelationBatch,
} from './note-relations';

export async function findNoteRelations(note: Note) {
  if (!config(note.scope).enabled || !eligible(note)) return;
  const notes = (await repo.list(note.scope)).filter(eligible);
  const records = await knowledge.list(note.scope);
  const guard = async (input: unknown) => {
    const payload = input as {
      source?: { id: string };
      candidates?: { id: string }[];
      notes?: { id: string }[];
    };
    const ids = [
      ...(payload.source ? [payload.source] : []),
      ...(payload.candidates || payload.notes || []),
    ].map((n) => n.id);
    const live = await repo.list(note.scope);
    if (
      !config(note.scope).enabled ||
      ids.some((id) => {
        const current = live.find((n) => n.id === id),
          before = notes.find((n) => n.id === id);
        return !current || !before || !eligible(current) || current.content !== before.content;
      })
    )
      throw new Error('Notizen oder KI-Freigaben haben sich geändert. Bitte erneut prüfen.');
  };
  const result = await discoverRelations(
    note,
    notes,
    records.filter((r) => r.kind === 'note-relations').map((r) => r.data as RelationBatch),
    async (input) => {
      await guard(input);
      return structured(note.scope, candidateInstructions, input, candidateResponse);
    },
    async (input) => {
      await guard(input);
      return structured(note.scope, relationInstructions, input, relationResponse);
    },
  );
  const fresh = (await repo.list(note.scope)).filter(eligible);
  const current = fresh.find((n) => n.id === note.id);
  if (!config(note.scope).enabled || !current || contentRevision(current) !== contentRevision(note)) return;
  result.suggestions = result.suggestions.filter((r) => validRelation(r, fresh));
  if (result.checked.length) await knowledge.append(note, 'note-relations', result);
}
