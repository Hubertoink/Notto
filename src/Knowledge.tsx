import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal, NoteMarkdown, readableDate } from './components';
import { useNotto } from './state';
import { desktop } from './repository';
import { attachmentIds, titleOf, type Note } from './domain';
import {
  analyze,
  ask,
  config,
  decisionKey,
  defaults,
  eligible,
  extract,
  knowledge,
  latest,
  research,
  resolvedDecision,
  saveConfig,
  semanticSearch,
  type Analysis,
  type AIConfig,
  type Decision,
  type Evidence,
  type KnowledgeRecord,
  type Research,
  type Suggestion,
} from './intelligence';

export function IntelligenceWorker() {
  const { scope, notes, notify } = useNotto();
  const running = useRef(false),
    failed = useRef(new Set<string>());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (scope === 'local') return;
    let syncing = false,
      closed = false,
      lastError = '';
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      if (syncing || closed || !navigator.onLine) return;
      syncing = true;
      try {
        await knowledge.sync(scope);
        lastError = '';
      } catch (e) {
        const message = String(e);
        if (message !== lastError) {
          notify(`Wissen-Sync: ${message}`);
          lastError = message;
        }
      } finally {
        syncing = false;
      }
    };
    const change = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void sync(), 2500);
    };
    void sync();
    const timer = setInterval(() => void sync(), 60000);
    window.addEventListener('notto-knowledge', change);
    window.addEventListener('online', change);
    return () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(debounce);
      window.removeEventListener('notto-knowledge', change);
      window.removeEventListener('online', change);
    };
  }, [scope, notify]);
  useEffect(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 10000);
    const change = () => {
      failed.current.clear();
      setTick((x) => x + 1);
    };
    window.addEventListener('notto-ai-config', change);
    return () => {
      clearInterval(timer);
      window.removeEventListener('notto-ai-config', change);
    };
  }, []);
  useEffect(() => {
    const c = config(scope);
    if (!c.enabled || !c.auto || running.current) return;
    let cancelled = false;
    const run = async () => {
      running.current = true;
      try {
        const records = await knowledge.list(scope);
        const note = notes.find(
          (n) => eligible(n) && !latest(records, 'analysis', n) && !failed.current.has(n.revision),
        );
        if (cancelled) return;
        if (!note) {
          if (c.autoResearch) {
            const candidates = notes
              .filter(eligible)
              .flatMap((n) =>
                ((latest(records, 'analysis', n)?.data as Analysis)?.suggestions || [])
                  .filter((item) => item.kind !== 'topic')
                  .map((item) => ({ note: n, item })),
              );
            const next = candidates.find(({ note: n, item }) => {
              const key = decisionKey(n.id, item);
              return (
                !failed.current.has(key) &&
                resolvedDecision(records, key)?.status !== 'dismissed' &&
                !records.some((r) => r.kind === 'research' && (r.data as any).key === key)
              );
            });
            if (next)
              try {
                await research(next.note, next.item);
              } catch (e) {
                failed.current.add(decisionKey(next.note.id, next.item));
                notify(`Recherche pausiert: ${String(e)}`);
              }
          }
          return;
        }
        try {
          await analyze(note);
        } catch (e) {
          failed.current.add(note.revision);
          notify(`KI pausiert für diese Fassung: ${String(e)}`);
        }
      } catch (e) {
        notify(`KI-Speicher nicht verfügbar: ${String(e)}`);
      } finally {
        running.current = false;
      }
    };
    const timer = setTimeout(() => {
      if (navigator.locks)
        void navigator.locks.request(`notto-analyze:${scope}`, { ifAvailable: true }, (lock) =>
          lock ? run() : undefined,
        );
      else void run();
    }, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, notes, tick, notify]);
  return null;
}

export function Knowledge({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { scope, notes } = useNotto();
  const [records, setRecords] = useState<KnowledgeRecord[]>([]),
    [tab, setTab] = useState('overview');
  const [settings, setSettings] = useState<AIConfig>(() => config(scope));
  const [key, setKey] = useState(''),
    [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Evidence[]>([]),
    [answer, setAnswer] = useState('');
  const [correction, setCorrection] = useState<{
    note: Note;
    item: Suggestion;
    title: string;
    detail: string;
  } | null>(null);
  const [source, setSource] = useState<{ title: string; text: string } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const refresh = () =>
      void knowledge
        .list(scope)
        .then((r) => live.current && setRecords(r))
        .catch((e) => live.current && setError(String(e)));
    refresh();
    window.addEventListener('notto-knowledge', refresh);
    if (desktop)
      void invoke<boolean>('ai_key_status')
        .then(setHasKey)
        .catch((e) => setError(String(e)));
    return () => {
      live.current = false;
      window.removeEventListener('notto-knowledge', refresh);
    };
  }, [scope]);
  const update = (patch: Partial<AIConfig>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveConfig(scope, next);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await fn();
      if (live.current) setMessage('Abgeschlossen.');
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (live.current) setBusy('');
    }
  };
  const included = notes.filter(eligible);
  const entries = included.flatMap((note) => {
    const record = latest(records, 'analysis', note);
    return ((record?.data as Analysis)?.suggestions || []).map((item) => ({
      note,
      item,
      decision: resolvedDecision(records, decisionKey(note.id, item)),
    }));
  });
  const decide = async (
    note: Note,
    item: Suggestion,
    status: Decision['status'],
    title = item.title,
    detail = item.detail,
  ) => {
    await knowledge.append(note, 'decision', { key: decisionKey(note.id, item), status, title, detail });
  };
  return (
    <Modal title="Wissen & KI" onClose={onClose} width={1000}>
      <p className="muted">
        Deine Originale bleiben unverändert. Hier liegen abgeleitete Vorschläge, geprüfte Entscheidungen und
        Quellen.
      </p>
      <div className="knowledge-tabs segmented">
        {[
          ['overview', 'Überblick'],
          ['task', 'Aufgaben'],
          ['contact', 'Kontakte'],
          ['topic', 'Themen'],
          ['search', 'Suchen & Fragen'],
          ['files', 'Anhänge'],
          ['settings', 'KI einrichten'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {busy && (
        <p role="status" className="knowledge-progress">
          {busy} … Du kannst weiter in deinen Notizen arbeiten.
        </p>
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
      {tab === 'settings' ? (
        <section className="settings-section">
          <h3>OpenAI verbinden</h3>
          <p className="muted">
            Aktivierte KI-Funktionen senden freigegebene Texte an OpenAI. OCR sendet ausgewählte Bilder oder
            PDF-Seiten; Diktat sendet die Aufnahme. Recherche übermittelt den sichtbaren Suchbegriff an die
            Websuche.
          </p>
          {desktop ? (
            <>
              <label>
                API-Schlüssel {hasKey ? '· sicher hinterlegt' : ''}
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-…"
                />
              </label>
              <div className="settings-actions">
                <Action
                  label="Schlüssel hinterlegen"
                  isDisabled={!key || !!busy}
                  onClick={() =>
                    void run('Schlüssel speichern', async () => {
                      await invoke('ai_set_key', { key: key.trim() });
                      setKey('');
                      setHasKey(true);
                    })
                  }
                />
                <Action
                  label="Schlüssel entfernen"
                  isDisabled={!hasKey || !!busy}
                  onClick={() =>
                    void run('Schlüssel entfernen', async () => {
                      await invoke('ai_set_key', { key: '' });
                      setHasKey(false);
                      update({ enabled: false });
                    })
                  }
                />
              </div>
            </>
          ) : (
            <p>
              Die Webversion verwendet die authentifizierte Supabase-Funktion <code>notto-ai</code>. Der
              API-Schlüssel wird dort als Server-Secret eingerichtet. Anleitung: docs/AI-SETUP.md im Projekt.
            </p>
          )}
          <label>
            Analysemodell
            <input
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={defaults.model}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />{' '}
            KI für dieses Notizbuch auf diesem Gerät aktivieren
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.auto}
              onChange={(e) => update({ auto: e.target.checked })}
            />{' '}
            Gespeicherte Notizen im Hintergrund analysieren, solange Notto geöffnet ist
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.autoResearch}
              onChange={(e) => update({ autoResearch: e.target.checked })}
            />{' '}
            Aufgaben und Kontaktkandidaten nach der Hintergrundanalyse automatisch im Web recherchieren
          </label>
          <label>
            Ausgeschlossene Tags
            <input value={settings.excludedTags} onChange={(e) => update({ excludedTags: e.target.value })} />
          </label>
          <label>
            Maximale KI-Anfragen pro Tag auf diesem Gerät
            <input
              type="number"
              min="1"
              max="200"
              value={settings.dailyLimit}
              onChange={(e) =>
                update({ dailyLimit: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })
              }
            />
          </label>
          <p className="muted">
            Anfragen können Kosten verursachen. Das Anfragelimit ist kein Geldlimit. Fehlgeschlagene
            Hintergrundanalysen werden erst nach manueller Wiederholung oder einer neuen Fassung erneut
            versucht. Recherche und OCR startest du ausdrücklich.
          </p>
        </section>
      ) : tab === 'search' ? (
        <section className="knowledge-section">
          <label>
            Was möchtest du finden oder wissen?
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Was steht für den Medienraum noch an?"
            />
          </label>
          <div className="settings-actions">
            <Action
              label="Sinngemäß suchen"
              isDisabled={!query.trim() || !!busy}
              onClick={() =>
                void run('Suchindex aufbauen und suchen', async () => {
                  setAnswer('');
                  setResults(await semanticSearch(scope, query, notes));
                })
              }
            />
            <Action
              label="Notizbuch fragen"
              variant="primary"
              isDisabled={!query.trim() || !!busy}
              onClick={() =>
                void run('Belegte Antwort erstellen', async () => {
                  const r = await ask(scope, query, notes);
                  setAnswer(r.answer);
                  setResults(r.citations.map((c) => ({ ...r.sources[c.index], text: c.quote })));
                })
              }
            />
          </div>
          <p className="muted">
            Beim ersten Suchen entsteht ein wiederverwendbarer Index. PDFs und Bilder werden nach der
            Texterkennung berücksichtigt.
          </p>
          {answer && (
            <div className="knowledge-card">
              <NoteMarkdown content={answer} scope={scope} />
            </div>
          )}
          {results.map((r, i) => (
            <article className="knowledge-card" key={i}>
              <button className="text-button" onClick={() => onOpen(r.noteId)}>
                {titleOf(notes.find((n) => n.id === r.noteId)?.content || 'Original')}{' '}
                {r.page ? `· PDF Seite ${r.page}` : ''}
              </button>
              <blockquote>{r.text}</blockquote>
            </article>
          ))}
        </section>
      ) : tab === 'files' ? (
        <section className="knowledge-section">
          <p className="muted">
            PDF-Text wird lokal gelesen. OCR sendet Bilder oder gescannte Seiten an OpenAI. Höchstens 100
            PDF-Seiten, davon maximal fünf gescannte Seiten pro OCR-Aufruf.
          </p>
          {included.flatMap((note) =>
            attachmentIds(note.content).map((id) => (
              <article className="knowledge-card" key={`${note.id}:${id}`}>
                <button className="text-button" onClick={() => onOpen(note.id)}>
                  {titleOf(note.content)}
                </button>
                <p>
                  {id.endsWith('.pdf') ? 'PDF-Dokument' : 'Bild'} · {id.slice(0, 8)}
                </p>
                <div className="settings-actions">
                  {id.endsWith('.pdf') && (
                    <Action
                      label="PDF-Text lesen"
                      isDisabled={!!busy}
                      onClick={() => void run('PDF auslesen', () => extract(note, id))}
                    />
                  )}
                  <Action
                    label="Texterkennung mit KI"
                    isDisabled={!!busy}
                    onClick={() => void run('Text erkennen', () => extract(note, id, true))}
                  />
                  <Action
                    label="Erkannten Text ansehen"
                    isDisabled={
                      !records.some(
                        (r) => r.kind === 'extraction' && r.noteId === note.id && (r.data as any).id === id,
                      )
                    }
                    onClick={() => {
                      const r = records
                        .filter(
                          (r) => r.kind === 'extraction' && r.noteId === note.id && (r.data as any).id === id,
                        )
                        .sort((a, b) => b.at.localeCompare(a.at))[0];
                      setSource({
                        title: 'Erkannter Text · bitte prüfen',
                        text: (r.data as { pages: Evidence[] }).pages
                          .map((p) => `${p.page ? `Seite ${p.page}\n` : ''}${p.text}`)
                          .join('\n\n'),
                      });
                    }}
                  />
                </div>
              </article>
            )),
          )}
          {!included.some((n) => attachmentIds(n.content).length) && (
            <p>Noch keine freigegebenen Anhänge. Füge im Editor ein Bild oder PDF hinzu.</p>
          )}
        </section>
      ) : tab === 'overview' ? (
        <section className="knowledge-section">
          <div className="knowledge-card">
            <h3>
              {included.length} freigegebene Notizen · {entries.length} Vorschläge
            </h3>
            <p>
              Analysiere gespeicherte Notizen oder aktiviere die Hintergrundanalyse. Die KI erzeugt zunächst
              Vorschläge. Du entscheidest über die Übernahme.
            </p>
            <Action
              label="Offene Analysen starten"
              variant="primary"
              isDisabled={!!busy || !settings.enabled}
              onClick={() =>
                void run('Notizen analysieren', async () => {
                  for (const n of included)
                    if (!latest(await knowledge.list(scope), 'analysis', n)) await analyze(n);
                })
              }
            />
            {!settings.enabled && (
              <button className="text-button" onClick={() => setTab('settings')}>
                KI einrichten
              </button>
            )}
          </div>
          {notes
            .filter((n) => !n.deleted)
            .map((n) => (
              <article className="knowledge-card" key={n.id}>
                <button className="text-button" onClick={() => onOpen(n.id)}>
                  {titleOf(n.content)}
                </button>
                <p className="muted">
                  {!eligible(n)
                    ? 'Ausgeschlossen'
                    : latest(records, 'analysis', n)
                      ? 'Aktuelle Fassung analysiert'
                      : 'Analyse offen'}
                </p>
                <div className="settings-actions">
                  <Action
                    label="Neu analysieren"
                    isDisabled={!!busy || !eligible(n) || !settings.enabled}
                    onClick={() => void run('Notiz analysieren', () => analyze(n))}
                  />
                  <Action
                    label={settings.excludedNotes.includes(n.id) ? 'Wieder freigeben' : 'KI ausschließen'}
                    onClick={() =>
                      update({
                        excludedNotes: settings.excludedNotes.includes(n.id)
                          ? settings.excludedNotes.filter((id) => id !== n.id)
                          : [...settings.excludedNotes, n.id],
                      })
                    }
                  />
                </div>
              </article>
            ))}
          {scope !== 'local' && (
            <Action
              label="Wissen synchronisieren"
              isDisabled={!!busy}
              onClick={() => void run('Wissen synchronisieren', () => knowledge.sync(scope))}
            />
          )}
        </section>
      ) : (
        <section className="knowledge-section">
          {tab === 'topic' &&
            [
              ...new Set(
                entries
                  .filter((e) => e.item.kind === 'topic')
                  .map((e) => e.item.title.toLocaleLowerCase('de')),
              ),
            ].map((topic) => (
              <div className="knowledge-card" key={topic}>
                <h3>#{topic}</h3>
                {entries
                  .filter(
                    (e) =>
                      e.item.kind === 'topic' &&
                      e.item.title.toLocaleLowerCase('de') === topic &&
                      e.decision?.status !== 'dismissed',
                  )
                  .map(({ note }) => (
                    <button key={note.id} className="text-button" onClick={() => onOpen(note.id)}>
                      {titleOf(note.content)}
                    </button>
                  ))}
              </div>
            ))}
          {entries
            .filter((e) => e.item.kind === tab)
            .map(({ note, item, decision }, i) => (
              <article
                className={`knowledge-card ${decision?.status === 'dismissed' ? 'knowledge-dismissed' : ''}`}
                key={`${note.id}:${i}`}
              >
                <span className="eyebrow">
                  {decision?.status === 'done'
                    ? 'ERLEDIGT'
                    : decision?.status === 'accepted'
                      ? 'ÜBERNOMMEN'
                      : decision?.status === 'dismissed'
                        ? 'ABGELEHNT'
                        : 'KI-VORSCHLAG · UNBESTÄTIGT'}
                </span>
                <h3>{decision?.title || item.title}</h3>
                <p>{decision?.detail || item.detail}</p>
                <blockquote>{item.quote}</blockquote>
                <button className="text-button" onClick={() => onOpen(note.id)}>
                  Originalnotiz öffnen
                </button>
                <div className="settings-actions">
                  <Action
                    label="Übernehmen"
                    isDisabled={!!busy}
                    onClick={() =>
                      void run('Entscheidung speichern', () =>
                        decide(note, item, 'accepted', decision?.title, decision?.detail),
                      )
                    }
                  />
                  {tab === 'task' && (
                    <Action
                      label="Erledigt"
                      isDisabled={!!busy}
                      onClick={() =>
                        void run('Aufgabe abschließen', () =>
                          decide(note, item, 'done', decision?.title, decision?.detail),
                        )
                      }
                    />
                  )}
                  <Action
                    label="Korrigieren"
                    onClick={() =>
                      setCorrection({
                        note,
                        item,
                        title: decision?.title || item.title,
                        detail: decision?.detail || item.detail,
                      })
                    }
                  />
                  <Action
                    label="Ablehnen"
                    isDisabled={!!busy}
                    onClick={() =>
                      void run('Entscheidung speichern', () =>
                        decide(note, item, 'dismissed', decision?.title, decision?.detail),
                      )
                    }
                  />
                  {tab !== 'topic' && (
                    <Action
                      label="Im Web recherchieren"
                      isDisabled={!!busy}
                      onClick={() => void run(`Recherche: ${item.title}`, () => research(note, item))}
                    />
                  )}
                </div>
                {records
                  .filter(
                    (r) =>
                      r.kind === 'research' &&
                      r.noteId === note.id &&
                      (r.data as any).key === decisionKey(note.id, item),
                  )
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 1)
                  .map((r) => (
                    <div className="research-result" key={r.id}>
                      <span className="muted">
                        Recherche · {readableDate(r.at)} · bitte Identität und Angaben prüfen
                      </span>
                      <NoteMarkdown content={(r.data as Research).text} scope={scope} />
                      <ul>
                        {(r.data as Research).sources.map((s) => (
                          <li key={s.url}>
                            <NoteMarkdown
                              content={`[${s.title.replace(/[\[\]]/g, '')}](${s.url})`}
                              scope={scope}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </article>
            ))}
          {!entries.some((e) => e.item.kind === tab) && (
            <p>Noch keine Vorschläge. Starte eine Analyse im Überblick.</p>
          )}
          <details>
            <summary>Gespeicherte Entscheidungen (auch aus älteren Fassungen)</summary>
            {records
              .filter((r) => r.kind === 'decision')
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((r) => (
                <p key={r.id}>
                  {(r.data as Decision).title} · {(r.data as Decision).status} · {readableDate(r.at)}
                </p>
              ))}
          </details>
        </section>
      )}
      {correction && (
        <Modal title="Vorschlag korrigieren" onClose={() => setCorrection(null)}>
          <label>
            Titel
            <input
              value={correction.title}
              onChange={(e) => setCorrection({ ...correction, title: e.target.value })}
            />
          </label>
          <label>
            Details / bestätigte Kontaktdaten
            <textarea
              value={correction.detail}
              onChange={(e) => setCorrection({ ...correction, detail: e.target.value })}
            />
          </label>
          <Action
            label="Korrektur übernehmen"
            variant="primary"
            isDisabled={!!busy || !correction.title.trim()}
            onClick={() =>
              void run('Korrektur speichern', async () => {
                await decide(
                  correction.note,
                  correction.item,
                  'accepted',
                  correction.title,
                  correction.detail,
                );
                setCorrection(null);
              })
            }
          />
        </Modal>
      )}
      {source && (
        <Modal title={source.title} onClose={() => setSource(null)} width={800}>
          <pre className="extracted-text">{source.text}</pre>
        </Modal>
      )}
    </Modal>
  );
}
