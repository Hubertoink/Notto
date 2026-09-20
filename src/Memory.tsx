import { useState } from 'react';
import { Brain, Plus, Check, Pause, SlidersHorizontal, Sparkles, Pencil, ArrowRight } from 'lucide-react';
import { useNotto } from './state';
import { useKnowledgeRecords } from './Tasks';
import { memoryState, memoryUsable, type Memory } from './memory-policy';
import { saveMemory, suggestMemory } from './memory-client';
import { config, eligible, knowledge } from './intelligence';
import { contentRevision, titleOf } from './domain';
import { Action, Modal } from './components';
import './memory.css';

const categories = {
  fact: 'Projektwissen & Kontext',
  instruction: 'So soll Noto arbeiten',
  preference: 'Das hat Noto gelernt',
};
export function MemorySettings() {
  const { scope, notes } = useNotto();
  const records = useKnowledgeRecords(scope);
  const state = memoryState(records, scope);
  const [tab, setTab] = useState<keyof typeof categories>('instruction');
  const [editorOpen, setEditorOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [text, setText] = useState('');
  const [project, setProject] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [ownStatement, setOwnStatement] = useState(false);
  const [supersedes, setSupersedes] = useState<string[]>([]);
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
      if (!note || !eligible(note) || (source.quote && !note.content.includes(source.quote)))
        throw new Error(
          'Der bisherige Beleg fehlt. Prüfe die Quelle erneut oder bestätige den Text ausdrücklich als eigene Angabe.',
        );
      return {
        ...source,
        revision: contentRevision(note),
      };
    });
  const usable = (entry: Memory) =>
    !state.superseded.includes(entry.key) && memoryUsable(entry, notes, config(scope), scope);
  const needsReview = (entry: Memory) =>
    !state.superseded.includes(entry.key) && (entry.status === 'suggested' || !usable(entry));
  const available = state.entries.filter((e) => e.status === 'active' && usable(e));
  const pending = state.entries.filter(needsReview).length;
  const openEditor = (category: keyof typeof categories, entry: Memory | null = null) => {
    setTab(category);
    setEditing(entry);
    setText(entry?.text ?? '');
    setProject(entry?.project ?? '');
    setValidUntil(entry?.validUntil?.slice(0, 10) ?? '');
    setOwnStatement(false);
    setSupersedes(entry?.supersedes ?? []);
    setEditorOpen(true);
  };
  return (
    <section className="memory-dashboard" aria-label="Mein Kontext">
      <div className="memory-overview">
        <div className="memory-overview-status">
          <span className={`memory-symbol ${state.enabled ? 'is-active' : ''}`}>
            {state.enabled ? <Check size={22} /> : <Pause size={22} />}
          </span>
          <div>
            <h2>Personalisierung {state.enabled ? 'aktiviert' : 'pausiert'}</h2>
            <p>Noto berücksichtigt deinen freigegebenen Kontext bei neuen KI-Antworten.</p>
          </div>
        </div>
        <div className="memory-metrics" aria-label="Verfügbarer Kontext">
          {(Object.keys(categories) as (keyof typeof categories)[]).map((category) => (
            <div key={category}>
              <strong>{available.filter((e) => e.category === category).length}</strong>
              <span>
                {category === 'fact'
                  ? 'Informationen'
                  : category === 'instruction'
                    ? 'Anweisungen'
                    : 'Präferenzen'}
              </span>
            </div>
          ))}
        </div>
        <button
          className="memory-toggle"
          disabled={busy}
          onClick={() => void run(() => settings({ enabled: !state.enabled }))}
        >
          {state.enabled ? 'Pausieren' : 'Aktivieren'}
        </button>
      </div>
      {(pending > 0 || reviewOnly) && (
        <button
          className="memory-review-banner"
          aria-pressed={reviewOnly}
          onClick={() => setReviewOnly(!reviewOnly)}
        >
          <Sparkles size={17} />
          <span>
            {pending} {pending === 1 ? 'Eintrag braucht' : 'Einträge brauchen'} deine Prüfung
          </span>
          <span>
            {reviewOnly ? 'Alle Einträge zeigen' : 'Jetzt prüfen'} <ArrowRight size={14} />
          </span>
        </button>
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
      <div className="memory-columns">
        {(Object.keys(categories) as (keyof typeof categories)[]).map((category) => {
          const Icon =
            category === 'fact' ? Brain : category === 'instruction' ? SlidersHorizontal : Sparkles;
          const entries = state.entries
            .filter((e) => e.category === category && (!reviewOnly || needsReview(e)))
            .sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)));
          const all = expanded.includes(category);
          return (
            <section
              className={`memory-column memory-${category}`}
              key={category}
              aria-label={categories[category]}
            >
              <header>
                <span className="memory-symbol">
                  <Icon size={22} />
                </span>
                <div>
                  <h3>{categories[category]}</h3>
                  <p>
                    {category === 'fact'
                      ? 'Dein Arbeitsumfeld, Projekte und wichtige Begriffe.'
                      : category === 'instruction'
                        ? 'Deine Regeln für Antworten und Arbeitsweise.'
                        : 'Präferenzen aus deinen ausdrücklichen Korrekturen.'}
                  </p>
                </div>
              </header>
              {category !== 'preference' && (
                <button className="memory-add" disabled={busy} onClick={() => openEditor(category)}>
                  <Plus size={16} />
                  {category === 'fact' ? 'Information hinzufügen' : 'Anweisung hinzufügen'}
                </button>
              )}
              {category === 'preference' && (
                <label className="memory-learning">
                  <input
                    type="checkbox"
                    checked={state.autoLearn}
                    disabled={busy}
                    onChange={(e) => void run(() => settings({ autoLearn: e.target.checked }))}
                  />
                  <span>
                    Korrekturen automatisch übernehmen<small>Sonst prüfst du jeden Vorschlag zuerst.</small>
                  </span>
                </label>
              )}
              <div className="memory-list">
                {(all ? entries : entries.slice(0, 3)).map((entry) => (
                  <article className="memory-card" key={entry.key}>
                    <div className="memory-card-top">
                      <span className={`memory-entry-status ${needsReview(entry) ? 'needs-review' : ''}`}>
                        {state.superseded.includes(entry.key)
                          ? 'Ersetzt'
                          : entry.validUntil && Date.parse(entry.validUntil) <= Date.now()
                            ? 'Abgelaufen'
                            : !usable(entry)
                              ? 'Quelle prüfen'
                              : entry.status === 'suggested'
                                ? 'Vorschlag'
                                : state.enabled
                                  ? 'Aktiv'
                                  : 'Pausiert'}
                      </span>
                      <button
                        className="memory-edit"
                        aria-label="Bearbeiten"
                        title="Bearbeiten"
                        disabled={busy}
                        onClick={() => openEditor(category, entry)}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <p>{entry.text}</p>
                    {entry.project && <small className="muted">Projekt: {entry.project}</small>}
                    {entry.validUntil && (
                      <small className="muted">
                        {' '}
                        · Gültig bis {new Date(entry.validUntil).toLocaleDateString('de')}
                      </small>
                    )}
                    {entry.status === 'suggested' && usable(entry) && (
                      <button
                        className="memory-add"
                        disabled={busy}
                        onClick={() => void run(() => saveMemory(scope, { ...entry, status: 'active' }))}
                      >
                        <Check size={15} />
                        Bestätigen
                      </button>
                    )}
                    {!usable(entry) && (
                      <small className="muted">
                        Dieser Eintrag wird nicht verwendet: Er wurde ersetzt, ist abgelaufen oder seine
                        Quelle muss erneut geprüft werden.
                      </small>
                    )}
                    <details>
                      <summary>Details & Verwaltung</summary>
                      {entry.sources.length ? (
                        entry.sources.map((source) => (
                          <div key={source.noteId}>
                            <strong>
                              {titleOf(notes.find((n) => n.id === source.noteId)?.content ?? '')}
                            </strong>
                            {source.quote && <blockquote>{source.quote}</blockquote>}
                          </div>
                        ))
                      ) : (
                        <p className="muted">Von dir eingetragen.</p>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          openEditor(category);
                          setProject(entry.project ?? '');
                          setSupersedes([entry.key]);
                        }}
                      >
                        Durch neue Information ersetzen
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await saveMemory(scope, { ...entry, text: '', sources: [], status: 'forgotten' });
                            return 'Wird für künftige KI-Anfragen nicht mehr verwendet.';
                          })
                        }
                      >
                        Vergessen
                      </button>
                    </details>
                  </article>
                ))}
                {!entries.length && (
                  <div className="memory-empty">
                    <Icon size={24} />
                    <p>
                      {reviewOnly
                        ? 'Hier ist nichts zu prüfen.'
                        : category === 'fact'
                          ? 'Was sollte Noto über deinen Alltag wissen?'
                          : category === 'instruction'
                            ? 'Wie sollen deine Antworten aussehen?'
                            : 'Wenn du einen KI-Vorschlag korrigierst, erscheint die gelernte Präferenz hier.'}
                    </p>
                  </div>
                )}
              </div>
              <footer>
                {entries.length > 3 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setExpanded(all ? expanded.filter((c) => c !== category) : [...expanded, category])
                    }
                  >
                    {all ? 'Weniger anzeigen' : `Alle anzeigen (${entries.length})`} <ArrowRight size={14} />
                  </button>
                )}
                {category === 'fact' && (
                  <button className="text-button" disabled={busy} onClick={() => setExtractOpen(true)}>
                    Aus einer Notiz vorschlagen <ArrowRight size={14} />
                  </button>
                )}
              </footer>
            </section>
          );
        })}
      </div>
      <details className="memory-explanation">
        <summary>Du behältst die Kontrolle</summary>
        <p>
          Vorschläge aus Notizen bestätigst du immer selbst. Geänderte, gelöschte oder ausgeschlossene Quellen
          werden nicht verwendet. Dein Kontext gehört zu diesem Notizbuch; deine Originalnotizen bleiben
          unverändert.
        </p>
        <p>
          „Vergessen“ entfernt einen Eintrag aus künftigen KI-Anfragen. Frühere Speicherereignisse bleiben im
          Datenverlauf; bereits erzeugte Antworten werden nicht gelöscht.
        </p>
      </details>
      {editorOpen && (
        <Modal
          title={
            editing
              ? 'Eintrag bearbeiten'
              : tab === 'fact'
                ? 'Information hinzufügen'
                : 'Anweisung hinzufügen'
          }
          onClose={() => {
            if (!busy) setEditorOpen(false);
          }}
        >
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
                  sources: editing && !ownStatement ? sourcesNow(editing) : [],
                  project: project.trim() || undefined,
                  validUntil: validUntil ? `${validUntil}T23:59:59.999Z` : undefined,
                  supersedes,
                });
                setEditing(null);
                setText('');
                setEditorOpen(false);
              });
            }}
          >
            <label>
              {editing ? 'Eintrag bearbeiten und bestätigen' : `${categories[tab]} ergänzen`}
              <textarea
                aria-label="Kontexteintrag"
                autoFocus
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
            <label>
              Projekt oder Themenbereich (optional)
              <input value={project} maxLength={120} onChange={(event) => setProject(event.target.value)} />
            </label>
            <label>
              Gültig bis (optional)
              <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </label>
            {!!editing?.sources.length && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={ownStatement}
                  onChange={(event) => setOwnStatement(event.target.checked)}
                />
                Als eigene Angabe bestätigen und vom bisherigen Quellenbeleg lösen
              </label>
            )}
            {supersedes.length > 0 && (
              <p className="muted">Dieser Eintrag ersetzt die bisherige Information im KI-Kontext.</p>
            )}
            <div className="settings-actions">
              <button className="memory-save" type="submit" disabled={busy || !text.trim()}>
                {editing ? 'Änderungen speichern' : 'Eintrag speichern'}
              </button>
              {
                <Action
                  label="Abbrechen"
                  onClick={() => {
                    setEditing(null);
                    setText('');
                    setEditorOpen(false);
                  }}
                />
              }
            </div>
          </form>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </Modal>
      )}
      {extractOpen && (
        <Modal
          title="Kontext aus einer Notiz"
          onClose={() => {
            if (!busy) setExtractOpen(false);
          }}
        >
          <p className="muted">
            Noto schlägt belegte Informationen vor. Erst nach deiner Bestätigung werden sie verwendet.
          </p>
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
                  if (count) {
                    setExtractOpen(false);
                    setReviewOnly(true);
                  }
                  return count
                    ? `${count} Vorschläge zur Prüfung erstellt.`
                    : 'Keine neuen Kontextinformationen gefunden.';
                })
              }
            />
          </div>
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
        </Modal>
      )}
    </section>
  );
}
