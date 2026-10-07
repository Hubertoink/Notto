import { tagsOf, titleOf, type AIContext, type Note } from './domain';
import { collectionNames } from './collections';
import { eligible } from './intelligence';
import { webResearchEnabled } from './source-context';

export function ContextPicker({
  value,
  onChange,
  notes,
  current,
  disabled = false,
  names = [],
  commandWeb = true,
}: {
  value: AIContext;
  onChange: (value: AIContext) => void;
  notes: Note[];
  current: Note;
  disabled?: boolean;
  names?: string[];
  commandWeb?: boolean;
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
          checked={value.webPolicy === 'off'}
          onChange={(e) => onChange({ ...value, webPolicy: e.target.checked ? 'off' : 'inherit' })}
        />
        Webrecherche für diese Notiz ausschalten
      </label>
      <p className="muted small" role="status">
        {webResearchEnabled(value, { commandWeb })
          ? 'KI-Aufträge dürfen bei Bedarf im Web recherchieren. Die globale Einstellung wird übernommen.'
          : commandWeb
            ? 'KI-Aufträge verwenden nur die gewählten Notizen und Anhänge.'
            : 'Webrecherche für KI-Aufträge ist in „Wissen & KI“ ausgeschaltet.'}
      </p>
      <p className="muted small">
        Anhänge werden aufbereitet; passende Originalstellen fließen in die Analyse ein. Vollständige
        Zusammenfassungen lesen alle verfügbaren Abschnitte schrittweise. Ausgeschlossene Quellen bleiben
        ausgeschlossen.
      </p>
    </fieldset>
  );
}
