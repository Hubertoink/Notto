import { tagsOf, titleOf, type AIContext, type Note } from './domain';
import { collectionNames } from './collections';
import { eligible } from './intelligence';

export function ContextPicker({
  value,
  onChange,
  notes,
  current,
  disabled = false,
  names = [],
}: {
  value: AIContext;
  onChange: (value: AIContext) => void;
  notes: Note[];
  current: Note;
  disabled?: boolean;
  names?: string[];
}) {
  const collections = [
    ...new Set([
      ...collectionNames(notes, [], current.scope),
      ...(current.collections ?? []),
      ...names,
      ...(value.collection ? [value.collection] : []),
    ]),
  ];
  const available = notes.filter(
    (note) => note.scope === current.scope && note.id !== current.id && !note.archived && eligible(note),
  );
  const tags = [...new Set(available.flatMap((note) => tagsOf(note.content)))].sort();
  const unavailable =
    value.sourceIds?.filter((id) => id !== current.id && !available.some((note) => note.id === id)) ?? [];
  return (
    <fieldset className="context-picker" disabled={disabled}>
      <legend>KI-Kontext</legend>
      <label>
        Quellen verwenden
        <select
          aria-label="KI-Kontext"
          value={value.mode}
          onChange={(e) =>
            onChange({
              ...value,
              mode: e.target.value as AIContext['mode'],
              collection: value.collection || current.collections?.[0] || collections[0],
            })
          }
        >
          <option value="note">Diese Notiz und ihre Anhänge</option>
          <option value="collection" disabled={!collections.length}>
            Eine Sammlung
          </option>
          <option value="selected">Quellen und Tags auswählen</option>
          <option value="notebook">Gesamtes Notizbuch</option>
        </select>
      </label>
      {value.mode === 'collection' && (
        <label>
          Sammlung
          <select
            aria-label="Kontext-Sammlung"
            value={value.collection ?? ''}
            onChange={(e) => onChange({ ...value, collection: e.target.value })}
          >
            {collections.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      )}
      {value.mode === 'selected' && (
        <details open>
          <summary>Dokumente, Notizen und Tags</summary>
          <div className="context-source-list">
            {available.map((note) => (
              <label key={note.id}>
                <input
                  type="checkbox"
                  checked={value.sourceIds?.includes(note.id) ?? false}
                  disabled={(value.sourceIds?.length ?? 0) >= 30 && !value.sourceIds?.includes(note.id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      sourceIds: e.target.checked
                        ? [...(value.sourceIds ?? []), note.id].slice(0, 30)
                        : value.sourceIds?.filter((id) => id !== note.id),
                    })
                  }
                />
                {note.document ? 'Dokument: ' : 'Notiz: '}
                {titleOf(note.content)}
              </label>
            ))}
            {tags.map((tag) => (
              <label key={`tag:${tag}`}>
                <input
                  type="checkbox"
                  checked={value.tags?.includes(tag) ?? false}
                  disabled={(value.tags?.length ?? 0) >= 30 && !value.tags?.includes(tag)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      tags: e.target.checked
                        ? [...(value.tags ?? []), tag].slice(0, 30)
                        : value.tags?.filter((t) => t !== tag),
                    })
                  }
                />
                #{tag}
              </label>
            ))}
            {!available.length && <p>Noch keine weiteren freigegebenen Quellen.</p>}
            {unavailable.map((id) => (
              <p key={id}>
                Eine gewählte Quelle ist nicht verfügbar oder ausgeschlossen.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({ ...value, sourceIds: value.sourceIds?.filter((source) => source !== id) })
                  }
                >
                  Auswahl entfernen
                </button>
              </p>
            ))}
          </div>
        </details>
      )}
      <label className="context-web">
        <input
          type="checkbox"
          checked={value.web === true}
          onChange={(e) => onChange({ ...value, web: e.target.checked })}
        />
        Webquellen zusätzlich verwenden
      </label>
      <p className="muted small">
        Ausgeschlossene Quellen bleiben ausgeschlossen. Direkt gewählte Dokumente werden vollständig gelesen;
        im weiteren Kontext sucht Noto passende Textstellen.
      </p>
    </fieldset>
  );
}
