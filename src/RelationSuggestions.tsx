import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { type Note, titleOf } from './domain';
import { type KnowledgeRecord, eligible, knowledge } from './intelligence';
import { relationKey, visibleRelations, type Relation } from './note-relations';
import { NoteReferenceLink } from './components';

export function RelationSuggestions({
  note,
  notes,
  records,
  disabled,
  onAccept,
}: {
  note: Note;
  notes: Note[];
  records: KnowledgeRecord[];
  disabled: boolean;
  onAccept?: (r: Relation) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = notes.filter((n) => n.scope === note.scope && eligible(n));
  const suggestions = visibleRelations(note, allowed, records);
  if (!suggestions.length) return null;
  const act = async (r: Relation, accept: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (accept) {
        if (!onAccept) return;
        await onAccept(r);
      }
      await knowledge.append(note, 'relation-decision', {
        key: relationKey(r),
        status: accept ? 'accepted' : 'dismissed',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="relation-suggestions" aria-label="Passende Notizen">
      <h3>
        <Link2 size={16} /> Passende Notizen
      </h3>
      <p className="muted small">Inhaltliche Verbindungen · du entscheidest über die Übernahme.</p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {suggestions.map((r) => (
        <article key={relationKey(r)}>
          <NoteReferenceLink scope={note.scope} id={r.targetId} />
          <p>{r.reason}</p>
          <p className="small">Verlinken: „{r.anchor}“</p>
          <details>
            <summary>Belegstellen ansehen</summary>
            <small>Diese Notiz</small>
            <blockquote>{r.sourceQuote}</blockquote>
            <small>{titleOf(allowed.find((n) => n.id === r.targetId)!.content)}</small>
            <blockquote>{r.targetQuote}</blockquote>
          </details>
          <div className="relation-actions">
            <button
              className="annotation-command"
              disabled={disabled || busy || !onAccept}
              onClick={() => void act(r, true)}
            >
              Verknüpfung übernehmen
            </button>
            <button
              className="annotation-command annotation-command-secondary"
              disabled={busy}
              onClick={() => void act(r, false)}
            >
              Verwerfen
            </button>
          </div>
          {disabled && <small>Änderungen zuerst speichern.</small>}
        </article>
      ))}
    </section>
  );
}
