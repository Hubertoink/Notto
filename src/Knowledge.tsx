import { AttachmentTitle } from './AttachmentTitle';
import { findNoteRelations } from './relation-client';
import { pairKey, linkedTo, type RelationBatch } from './note-relations';
import { AIActivity, type BackgroundJob } from './AIActivity';
import { Topics } from './Topics';
import { Organization } from './Organization';
import { MemorySettings } from './Memory';
import { Sources } from './components';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal, NoteMarkdown, readableDate } from './components';
import { useNotto } from './state';
import { desktop } from './repository';
import { ownBackend, readCloudConfig } from './cloud';
import { serverRequest } from './backend';
import { analysisModels } from './ai-models';
import { attachmentIds, titleOf, type Note } from './domain';
import {
  analyze,
  config,
  defaults,
  decisionKey,
  eligible,
  extract,
  knowledge,
  latest,
  indexNotebook,
  research,
  resolvedDecision,
  saveConfig,
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
    const error = (e: Event) => notify((e as CustomEvent<string>).detail);
    window.addEventListener('notto-ai-error', error);
    return () => window.removeEventListener('notto-ai-error', error);
  }, [scope, notify]);
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
    if (!c.enabled || !c.auto || running.current || (scope !== 'local' && ownBackend())) return;
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
          const checkedPairs = new Set(
            records
              .filter((r) => r.kind === 'note-relations')
              .flatMap((r) => (r.data as RelationBatch).checked),
          );
          const allowed = notes.filter((n) => eligible(n) && n.content.length <= 60000);
          const pendingRelations = allowed.find(
            (n) =>
              !failed.current.has(`relations:${n.revision}`) &&
              allowed.some(
                (other) =>
                  n.id !== other.id &&
                  !linkedTo(n, other.id) &&
                  !linkedTo(other, n.id) &&
                  !checkedPairs.has(pairKey(n, other)),
              ),
          );
          if (pendingRelations) {
            try {
              await findNoteRelations(pendingRelations);
            } catch (e) {
              failed.current.add(`relations:${pendingRelations.revision}`);
              notify(`Notizverbindungen konnten nicht geprüft werden: ${String(e)}`);
            }
            return;
          }
          if (c.autoResearch) {
            const candidates = notes
              .filter(eligible)
              .flatMap((n) =>
                ((latest(records, 'analysis', n)?.data as Analysis)?.suggestions || [])
                  .filter((item) => item.kind === 'task' || item.kind === 'contact')
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
            if (next) return;
          }
          await indexNotebook(scope, notes);
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

export function Knowledge({ active = true, onOpen }: { active?: boolean; onOpen: (id: string) => void }) {
  const { scope, notes } = useNotto();
  const [serverJobs, setServerJobs] = useState<BackgroundJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [serverKeyReady, setServerKeyReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active || scope === 'local' || !ownBackend()) return;
    let current = true;
    setServerJobs([]);
    setJobsLoaded(false);
    setJobsError('');
    const refresh = async () => {
      try {
        const [status, jobs] = await Promise.all([
          serverRequest(readCloudConfig().url, '/ai/settings'),
          serverRequest(readCloudConfig().url, '/ai/jobs'),
        ]);
        if (current) {
          setServerKeyReady(status.configured);
          setServerJobs(jobs.jobs);
          setJobsLoaded(true);
          setJobsError('');
        }
      } catch (error) {
        if (current) setJobsError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [scope, active]);
  const [records, setRecords] = useState<KnowledgeRecord[]>([]),
    [tab, setTab] = useState('overview');
  const [settings, setSettings] = useState<AIConfig>(() => config(scope));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [settingsReady, setSettingsReady] = useState(scope === 'local' || !ownBackend());
  const [settingsReload, setSettingsReload] = useState(0);
  useEffect(() => {
    if (scope === 'local' || !ownBackend()) return;
    let cancelled = false;
    void serverRequest(readCloudConfig().url, '/ai/settings')
      .then(({ config: remote }) => {
        if (cancelled) return;
        const current = { ...defaults, ...remote };
        localStorage.setItem(`notto-ai:${scope}`, JSON.stringify(current));
        if (!dirtyRef.current) setSettings(current);
        setSettingsReady(true);
        setSaveError('');
        window.dispatchEvent(new Event('notto-ai-config'));
      })
      .catch(() => {
        if (!cancelled) {
          setSaveError(
            'Server-Einstellungen konnten nicht geladen werden. Prüfe die Verbindung, bevor du speicherst.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope, settingsReload]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const [key, setKey] = useState(''),
    [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsRefresh, setModelsRefresh] = useState(0);
  useEffect(() => {
    if (tab !== 'settings') return;
    let active = true;
    setModelsLoading(true);
    setModelsError('');
    setModels([]);
    const load = async () => {
      if (desktop && (scope === 'local' || !ownBackend())) {
        if (!hasKey) throw new Error('Hinterlege zuerst deinen OpenAI-Schlüssel.');
        return analysisModels(await invoke<string[]>('ai_models'));
      }
      if (scope === 'local') throw new Error('Melde dich an, um die serverseitige KI zu nutzen.');
      if (!ownBackend())
        throw new Error('Verbinde dich mit dem Noto-Server, um Modelle automatisch zu laden.');
      return (await serverRequest(readCloudConfig().url, '/ai/models')).models as string[];
    };
    void load()
      .then((ids) => {
        if (!active) return;
        setModels(ids);
        if (!ids.length)
          setModelsError('Für diesen Schlüssel wurden keine unterstützten Analysemodelle gefunden.');
      })
      .catch((e) => active && setModelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setModelsLoading(false));
    return () => {
      active = false;
    };
  }, [tab, scope, hasKey, modelsRefresh]);
  useEffect(() => {
    const refresh = () => {
      if (!dirtyRef.current) setSettings(config(scope));
    };
    window.addEventListener('notto-ai-config', refresh);
    return () => window.removeEventListener('notto-ai-config', refresh);
  }, [scope]);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
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
    if (saving || !settingsReady) return;
    setSettings((current) => ({ ...current, ...patch }));
    dirtyRef.current = true;
    setDirty(true);
    setSavedMessage('');
    setSaveError('');
  };
  const persist = async () => {
    if (saving || !settingsReady) return;
    setSaving(true);
    setSaveError('');
    setSavedMessage('');
    try {
      await saveConfig(scope, settings);
      dirtyRef.current = false;
      setDirty(false);
      setSavedMessage(
        scope !== 'local' && ownBackend()
          ? 'KI-Einstellungen im Konto gespeichert.'
          : 'KI-Einstellungen auf diesem Gerät gespeichert.',
      );
    } catch (e) {
      setSaveError(`Nicht gespeichert: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
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
    return ((record?.data as Analysis)?.suggestions || [])
      .filter((item) => item.kind !== 'insight')
      .map((item) => ({
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
    <section className="knowledge-content" aria-label="Wissen & KI">
      <div className="knowledge-heading">
        <h1>Wissen & KI</h1>
      </div>
      <p className="muted">Notizen ordnen, Zusammenhänge finden und deinen persönlichen Kontext verwalten.</p>
      <div className="knowledge-tabs segmented">
        {[
          ['overview', 'Überblick'],
          ['organize', 'Notizsekretär'],
          ['task', 'Aufgabenvorschläge'],
          ['contact', 'Kontakte'],
          ['topic', 'Themen'],
          ['files', 'Anhänge'],
          ['memory', 'Mein Kontext'],
          ['settings', 'KI einrichten'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {(tab === 'settings' || dirty || savedMessage || saveError) && (
        <div className="ai-save-bar">
          <div aria-live="polite">
            <strong>
              {saving
                ? 'Wird gespeichert …'
                : dirty
                  ? 'Ungespeicherte Änderungen'
                  : savedMessage || 'KI-Einstellungen'}
            </strong>
            <p className="muted small">
              {dirty
                ? 'Erst nach dem Speichern werden die Änderungen aktiv.'
                : scope !== 'local' && ownBackend()
                  ? 'Diese Einstellungen gelten für dein Konto auf allen Geräten.'
                  : 'Diese Einstellungen gelten für das lokale Notizbuch.'}
            </p>
            {saveError && (
              <p role="alert" className="inline-error">
                {saveError}
              </p>
            )}
            {!settingsReady && saveError && (
              <button className="text-button" onClick={() => setSettingsReload((v) => v + 1)}>
                Einstellungen erneut laden
              </button>
            )}
          </div>
          <Action
            label="Einstellungen speichern"
            variant="primary"
            isLoading={saving}
            isDisabled={saving || !settingsReady || !!busy}
            onClick={() => void persist()}
          />
        </div>
      )}
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
      {tab === 'organize' ? (
        <Organization key={scope} scope={scope} notes={notes} records={records} onOpen={onOpen} />
      ) : tab === 'memory' ? (
        <MemorySettings key={scope} />
      ) : tab === 'settings' ? (
        <fieldset className="settings-section ai-settings-fields" disabled={saving || !settingsReady}>
          <h3>OpenAI verbinden</h3>
          <p className="muted">
            Aktivierte KI-Funktionen senden freigegebene Texte an OpenAI. OCR sendet ausgewählte Bilder oder
            PDF-Seiten; Diktat sendet die Aufnahme. Recherche übermittelt den sichtbaren Suchbegriff an die
            Websuche.
          </p>
          {desktop && scope === 'local' ? (
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
              Dein Noto-Server führt die KI-Anfragen aus. Den OpenAI-Schlüssel hinterlegst du einmalig in den
              Server-Einstellungen bei Mittwald. Er wird nicht auf deine Geräte übertragen.
              {serverKeyReady !== null &&
                (serverKeyReady
                  ? ' OpenAI ist verbunden.'
                  : ' Der OpenAI-Schlüssel fehlt noch auf dem Server.')}
            </p>
          )}
          <label>
            Analysemodell
            <select
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              disabled={modelsLoading || !models.length}
              aria-describedby="model-description"
            >
              {!models.includes(settings.model) && (
                <option value={settings.model} disabled>
                  {settings.model} · {modelsLoading ? 'wird geprüft …' : 'nicht bestätigt'}
                </option>
              )}
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <p id="model-description" className="muted small">
            Automatisch von OpenAI geladen. Angezeigt werden verfügbare Modelle der unterstützten
            Analysefamilien. Die Auswahl gilt auch für Hintergrundanalysen.
          </p>
          {modelsLoading && (
            <p role="status" className="muted small">
              Modelle werden geladen …
            </p>
          )}
          {modelsError && (
            <p role="alert" className="inline-error">
              {modelsError}
            </p>
          )}
          <button
            className="text-button small"
            disabled={modelsLoading}
            onClick={() => setModelsRefresh((v) => v + 1)}
          >
            Modellliste neu laden
          </button>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />{' '}
            KI für dieses Notizbuch aktivieren
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.auto}
              onChange={(e) => update({ auto: e.target.checked })}
            />{' '}
            Gespeicherte Notizen im Hintergrund analysieren{' '}
            {scope !== 'local' && ownBackend()
              ? '– auch bei geschlossener App'
              : '– solange Noto geöffnet ist'}
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
            Notizen mit KI überarbeiten
            <select
              value={settings.rewriteMode ?? 'correct'}
              onChange={(e) => update({ rewriteMode: e.target.value as 'correct' | 'formulate' })}
            >
              <option value="correct">Nur Rechtschreibung, Grammatik und Formatierung</option>
              <option value="formulate">Zusätzlich Gedanken als lesbare Sätze ausformulieren</option>
            </select>
          </label>
          <p className="muted small">
            Der Zauberstab in der Notiz verwendet diese Einstellung. Offene Fragen bleiben offen; die KI soll
            keine Inhalte ergänzen.
          </p>
          <p className="muted">
            Fehlgeschlagene Hintergrundaufträge werden bis zu dreimal versucht. Webrecherche läuft bei
            aktivierter Automatik nach der Analyse; sonst startest du sie manuell. OCR startest du
            ausdrücklich.
          </p>
        </fieldset>
      ) : tab === 'files' ? (
        <section className="knowledge-section">
          <p className="muted">
            PDF-Text wird lokal gelesen. OCR sendet Bilder oder gescannte Seiten an OpenAI. Höchstens 100
            PDF-Seiten, davon maximal fünf gescannte Seiten pro OCR-Aufruf. Lesbarer PDF-Text fließt bei der
            Analyse in die KI-Anmerkungen der Notiz ein.
          </p>
          {included.flatMap((note) =>
            attachmentIds(note.content).map((id) => (
              <article className="knowledge-card" key={`${note.id}:${id}`}>
                <button className="text-button" onClick={() => onOpen(note.id)}>
                  {titleOf(note.content)}
                </button>
                <p>
                  <AttachmentTitle content={note.content} scope={note.scope} id={id} />
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
          {scope !== 'local' && ownBackend() && (
            <AIActivity
              jobs={serverJobs}
              notes={notes}
              loaded={jobsLoaded}
              error={jobsError}
              busy={busy}
              onOpen={onOpen}
            />
          )}
          <div className="knowledge-summary">
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
          <div className="knowledge-table-wrap">
            <table className="knowledge-table" aria-label="Notizen und Analysestatus">
              <thead>
                <tr>
                  <th scope="col">Notiz</th>
                  <th scope="col">Analyse</th>
                  <th scope="col">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {notes
                  .filter((n) => !n.deleted)
                  .map((n) => (
                    <tr key={n.id}>
                      <td>
                        <button className="text-button knowledge-note-title" onClick={() => onOpen(n.id)}>
                          {titleOf(n.content)}
                        </button>
                      </td>
                      <td>
                        <span className="knowledge-status">
                          {!eligible(n)
                            ? 'Ausgeschlossen'
                            : latest(records, 'analysis', n)
                              ? 'Aktuell'
                              : 'Analyse offen'}
                        </span>
                      </td>
                      <td>
                        <div className="knowledge-row-actions">
                          <Action
                            label="Neu analysieren"
                            isDisabled={!!busy || !eligible(n) || !settings.enabled}
                            onClick={() => void run('Notiz analysieren', () => analyze(n))}
                          />
                          <Action
                            label={
                              settings.excludedNotes.includes(n.id) ? 'Wieder freigeben' : 'KI ausschließen'
                            }
                            onClick={() =>
                              update({
                                excludedNotes: settings.excludedNotes.includes(n.id)
                                  ? settings.excludedNotes.filter((id) => id !== n.id)
                                  : [...settings.excludedNotes, n.id],
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!notes.some((n) => !n.deleted) && <p className="muted">Noch keine gespeicherten Notizen.</p>}
          </div>
          {scope !== 'local' && (
            <Action
              label="Wissen synchronisieren"
              isDisabled={!!busy}
              onClick={() => void run('Wissen synchronisieren', () => knowledge.sync(scope))}
            />
          )}
        </section>
      ) : tab === 'topic' ? (
        <Topics
          notes={notes.filter((n) => !n.deleted)}
          records={records.filter((r) => included.some((n) => n.id === r.noteId))}
          onOpen={onOpen}
        />
      ) : (
        <section className="knowledge-section">
          <div className="knowledge-table-wrap">
            <table
              className="knowledge-table"
              aria-label={tab === 'task' ? 'Aufgabenvorschläge' : 'Kontakte'}
            >
              <thead>
                <tr>
                  <th>Titel</th>
                  <th>Status</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .filter((e) => e.item.kind === tab)
                  .map(({ note, item, decision }) => (
                    <tr key={decisionKey(note.id, item)}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelectedEntry(decisionKey(note.id, item))}
                        >
                          {decision?.title || item.title}
                        </button>
                      </td>
                      <td>
                        {decision?.status === 'done'
                          ? 'Erledigt'
                          : decision?.status === 'accepted'
                            ? 'Übernommen'
                            : decision?.status === 'dismissed'
                              ? 'Abgelehnt'
                              : 'Vorschlag'}
                      </td>
                      <td>
                        <button className="text-button" onClick={() => onOpen(note.id)}>
                          {titleOf(note.content)}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {entries
            .filter((e) => e.item.kind === tab && decisionKey(e.note.id, e.item) === selectedEntry)
            .map(({ note, item, decision }, i) => (
              <Modal
                title={decision?.title || item.title}
                onClose={() => setSelectedEntry(null)}
                width={800}
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
                  {
                    <Action
                      label="Im Web recherchieren"
                      isDisabled={!!busy}
                      onClick={() => void run(`Recherche: ${item.title}`, () => research(note, item))}
                    />
                  }
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
                      <Sources sources={(r.data as Research).sources} />
                    </div>
                  ))}
              </Modal>
            ))}
          {!entries.some((e) => e.item.kind === tab) && (
            <p>Noch keine Vorschläge. Starte eine Analyse im Überblick.</p>
          )}
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
    </section>
  );
}
