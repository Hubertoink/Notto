import { useState } from 'react';
import { Brain, Plus } from 'lucide-react';
import { useNotto } from './state';
import { useKnowledgeRecords } from './Tasks';
import { memoryState, memoryUsable, type Memory } from './memory-policy';
import { saveMemory, suggestMemory } from './memory-client';
import { config, eligible, knowledge } from './intelligence';
import { titleOf } from './domain';
import { Action } from './components';
import './memory.css';

const categories = {
  instruction: 'Anweisungen',
  fact: 'Gemerkte Informationen',
  preference: 'Gelernte Präferenzen',
};
export function MemorySettings() {
  const { scope, notes } = useNotto();
  const records = useKnowledgeRecords(scope);
  const state = memoryState(records, scope);
  const [tab, setTab] = useState<keyof typeof categories>('instruction');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [text, setText] = useState('');
  const [selectedNote, setSelectedNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const run = async (fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await fn();
      setMessage(result || 'Gespeichert.');
      if (scope !== 'local') {
        try {
          await knowledge.sync(scope);
        } catch {
          setMessage('Lokal gespeichert. Die Konto-Synchronisation wird erneut versucht.');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const settings = (patch: Partial<Memory>) =>
    saveMemory(scope, {
      key: 'memory-settings',
      category: 'settings',
      text: '',
      status: 'active',
      sources: [],
      enabled: state.enabled,
      autoLearn: state.autoLearn,
      ...patch,
    });
  const sourcesNow = (entry: Memory) =>
    entry.sources.map((source) => {
      const note = notes.find((n) => n.id === source.noteId);
      return {
        ...source,
        revision: note?.revision ?? source.revision,
        quote: note?.content.includes(source.quote ?? '') ? source.quote : undefined,
      };
    });
  return (
    <section className="settings-section memory-settings" aria-label="Mein Kontext">
      <h3>
        <Brain size={18} /> Mein Kontext
      </h3>
      <p className="muted">
        Was Noto über deine Arbeitsweise berücksichtigen soll. Gilt für dieses Notizbuch; Originalnotizen
        bleiben unverändert.
      </p>
      <label className="memory-option">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void run(() => settings({ enabled: e.target.checked }))}
        />
        Persönlichen Kontext verwenden
      </label>
      <label className="memory-option">
        <input
          type="checkbox"
          checked={state.autoLearn}
          disabled={busy}
          onChange={(e) => void run(() => settings({ autoLearn: e.target.checked }))}
        />
        Ausdrückliche Korrekturen automatisch berücksichtigen
      </label>
      <p className="muted">
        Ohne automatische Übernahme bleiben Korrekturen Vorschläge. Aus Notizen abgeleitete Informationen
        bestätigst du immer selbst. Geänderte, gelöschte oder ausgeschlossene Quellen werden nicht verwendet.
      </p>
      <div className="memory-tabs" aria-label="Kontextbereiche">
        {Object.entries(categories).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key as typeof tab);
              setEditing(null);
              setText('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!text.trim()) return;
            await saveMemory(scope, {
              key: editing?.key ?? crypto.randomUUID(),
              category: tab,
              text: text.trim(),
              status: 'active',
              sources: editing ? sourcesNow(editing) : [],
            });
            setEditing(null);
            setText('');
          });
        }}
      >
        <label>
          {editing ? 'Eintrag bearbeiten und bestätigen' : `${categories[tab]} ergänzen`}
          <textarea
            aria-label="Kontexteintrag"
            value={text}
            maxLength={2000}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              tab === 'instruction'
                ? 'Zum Beispiel: Antworte knapp. Leitbildtexte sind keine Aufgaben.'
                : tab === 'fact'
                  ? 'Zum Beispiel: Mit Medienraum meine ich die vier PCs im Jugendhaus.'
                  : 'Zum Beispiel: Ordne Konzepttexte nach Zielgruppen und Angeboten.'
            }
          />
        </label>
        <div className="settings-actions">
          <button className="memory-save" type="submit" disabled={busy || !text.trim()}>
            {editing ? 'Änderungen speichern' : 'Eintrag speichern'}
          </button>
          {editing && (
            <Action
              label="Abbrechen"
              onClick={() => {
                setEditing(null);
                setText('');
              }}
            />
          )}
        </div>
      </form>
      {tab === 'fact' && (
        <div className="memory-extract">
          <label>
            Kontext aus einer Notiz vorschlagen
            <select
              aria-label="Quellnotiz für Kontext"
              value={selectedNote}
              onChange={(e) => setSelectedNote(e.target.value)}
            >
              <option value="">Notiz auswählen …</option>
              {notes.filter(eligible).map((note) => (
                <option value={note.id} key={note.id}>
                  {titleOf(note.content)}
                </option>
              ))}
            </select>
          </label>
          <Action
            label="Vorschläge erstellen"
            icon={<Plus size={16} />}
            isDisabled={busy || !selectedNote}
            onClick={() =>
              void run(async () => {
                const note = notes.find((n) => n.id === selectedNote);
                if (!note) throw new Error('Notiz nicht mehr verfügbar.');
                const count = await suggestMemory(note);
                return count
                  ? `${count} Vorschläge zur Prüfung erstellt.`
                  : 'Keine neuen Kontextinformationen gefunden.';
              })
            }
          />
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
      <div className="memory-list">
        {state.entries
          .filter((entry) => entry.category === tab)
          .map((entry) => {
            const usable = memoryUsable(entry, notes, config(scope), scope);
            return (
              <article key={entry.key} className="memory-card">
                <span className="eyebrow">
                  {!usable
                    ? 'QUELLE PRÜFEN · NICHT VERWENDET'
                    : entry.status === 'suggested'
                      ? 'VORSCHLAG · NICHT VERWENDET'
                      : state.enabled
                        ? 'FÜR KI FREIGEGEBEN'
                        : 'GEDÄCHTNIS PAUSIERT'}
                </span>
                <p>{entry.text}</p>
                {entry.sources.length > 0 && (
                  <details>
                    <summary>Herkunft ansehen</summary>
                    {entry.sources.map((source) => (
                      <div key={source.noteId}>
                        <strong>{titleOf(notes.find((n) => n.id === source.noteId)?.content ?? '')}</strong>
                        {source.quote && <blockquote>{source.quote}</blockquote>}
                      </div>
                    ))}
                  </details>
                )}
                <div className="settings-actions">
                  {entry.status === 'suggested' && usable && (
                    <Action
                      label="Bestätigen"
                      isDisabled={busy}
                      onClick={() => void run(() => saveMemory(scope, { ...entry, status: 'active' }))}
                    />
                  )}
                  <Action
                    label="Bearbeiten"
                    isDisabled={busy}
                    onClick={() => {
                      setEditing(entry);
                      setText(entry.text);
                    }}
                  />
                  <Action
                    label="Vergessen"
                    isDisabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await saveMemory(scope, { ...entry, text: '', sources: [], status: 'forgotten' });
                        if (editing?.key === entry.key) {
                          setEditing(null);
                          setText('');
                        }
                        return 'Wird für künftige KI-Anfragen nicht mehr verwendet.';
                      })
                    }
                  />
                </div>
              </article>
            );
          })}
      </div>
      {!state.entries.some((e) => e.category === tab) && (
        <p className="muted">
          Hier sind noch keine Einträge. Korrigierte KI-Vorschläge erscheinen unter „Gelernte Präferenzen“.
        </p>
      )}
      <p className="muted">
        „Vergessen“ entfernt den Eintrag aus künftigen KI-Anfragen. Frühere Speicherereignisse bleiben im
        Datenverlauf; Originalnotizen und bereits erzeugte Antworten werden nicht gelöscht.
      </p>
    </section>
  );
}
