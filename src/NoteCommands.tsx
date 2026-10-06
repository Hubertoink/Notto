import { isConnectionError } from './connection';
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, Play, RotateCw, Square } from 'lucide-react';
import { serverRequest } from './backend';
import { ownBackend, readCloudConfig } from './cloud';
import { Modal, NoteMarkdown, Sources, readableDate } from './components';
import { commandThreads, noteCommands, type NoteCommand } from './note-command';
import './note-commands.css';
import { CitationLink } from './CommandCitation';

function CommandImage({ command, id, title }: { command: string; id: string; title: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true,
      objectUrl = '';
    setUrl('');
    setError(false);
    void serverRequest(readCloudConfig().url, `/commands/${command}/images/${id}`, undefined, true)
      .then((blob) => {
        if (alive) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [command, id]);
  if (error) return <small>Screenshot konnte nicht geladen werden. Bitte die Notiz erneut öffnen.</small>;
  if (!url)
    return (
      <div className="command-image-loading" aria-label="Screenshot wird geladen">
        <LoaderCircle size={18} />
      </div>
    );
  return (
    <>
      <button
        className="command-image"
        aria-label={`Screenshot vergrößern: ${title}`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={`Screenshot: ${title}`} />
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <img className="command-image-full" src={url} alt={`Screenshot: ${title}`} />
        </Modal>
      )}
    </>
  );
}

export function NoteCommands({
  content,
  noteId,
  scope,
  dirty,
  onStart,
  onCount,
  onCompleted,
  onInsert,
}: {
  content: string;
  noteId?: string;
  scope: string;
  editing: boolean;
  dirty: boolean;
  onStart: (prompt: string, id: string) => Promise<NoteCommand>;
  onCount?: (count: number) => void;
  onCompleted?: () => Promise<void>;
  onInsert?: (text: string) => void;
}) {
  const drafts = [...new Set(noteCommands(content).map((command) => command.prompt))];
  const connected = scope !== 'local' && ownBackend();
  const [commands, setCommands] = useState<NoteCommand[]>([]);
  const threads = commandThreads(commands);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const pendingIds = useRef(new Map<string, string>());
  const startLock = useRef(false);
  const syncedCompletions = useRef(new Set<string>());
  useEffect(() => {
    onCount?.(threads.length);
  }, [threads.length, onCount]);
  useEffect(() => {
    if (!onCompleted) return;
    const completed = commands.filter(
      (command) =>
        command.status === 'done' &&
        (command.result?.items.length || command.result?.research) &&
        drafts.includes(command.prompt) &&
        !syncedCompletions.current.has(command.id),
    );
    if (!completed.length) return;
    completed.forEach((command) => syncedCompletions.current.add(command.id));
    void onCompleted();
  }, [commands, content, onCompleted]);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let alive = true,
      fetching = false;
    setCommands([]);
    setError('');
    setLoadError('');
    const load = async () => {
      if (!connected || !noteId || fetching || !navigator.onLine) return;
      fetching = true;
      try {
        const result = await serverRequest(
          readCloudConfig().url,
          `/commands?noteId=${encodeURIComponent(noteId)}`,
        );
        if (alive) {
          setCommands(result.commands);
          setLoadError('');
        }
      } catch (e) {
        if (alive)
          setLoadError(
            isConnectionError(e)
              ? ''
              : e instanceof Error
                ? e.message
                : 'Aufträge konnten nicht geladen werden.',
          );
      } finally {
        fetching = false;
      }
    };
    refresh.current = load;
    void load();
    const timer = setInterval(() => void load(), 5000);
    window.addEventListener('online', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('online', load);
    };
  }, [scope, noteId, connected]);
  async function start(prompt: string) {
    if (startLock.current) return;
    startLock.current = true;
    setBusy(prompt);
    setError('');
    const id = pendingIds.current.get(prompt) || crypto.randomUUID();
    pendingIds.current.set(prompt, id);
    try {
      const command = await onStart(prompt, id);
      pendingIds.current.delete(prompt);
      setCommands((old) => [command, ...old.filter((item) => item.id !== command.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auftrag konnte nicht gestartet werden.');
    } finally {
      startLock.current = false;
      setBusy('');
    }
  }
  async function cancel(id: string) {
    try {
      await serverRequest(readCloudConfig().url, `/commands/${id}/cancel`, {});
      setCommands((old) =>
        old.map((command) =>
          command.id === id ? { ...command, status: 'cancelled', stage: 'Abgebrochen' } : command,
        ),
      );
      await refresh.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Abbrechen fehlgeschlagen.');
    }
  }
  if (!drafts.length && !commands.length)
    return (
      <p className="command-hint">
        Mit <code>/ki</code> am Zeilenanfang einen KI-Auftrag formulieren. Neue Aufträge starten beim
        Speichern.
      </p>
    );
  return (
    <section className="note-commands" aria-label="KI-Aufträge">
      {!connected && <p>Für Hintergrundaufträge bitte mit deinem Noto-Server anmelden.</p>}
      {drafts
        .filter((prompt) => !commands.some((command) => command.prompt === prompt))
        .map((prompt) => {
          const active = commands.some(
            (command) => command.prompt === prompt && ['pending', 'running'].includes(command.status),
          );
          return (
            <div className="command-composer" key={prompt}>
              <p>
                <code>/ki</code> {prompt || 'Schreibe deinen Auftrag hinter /ki in die Notiz.'}
              </p>
              <button
                type="button"
                disabled={!connected || !prompt || prompt.length > 4000 || !!busy || active}
                onClick={() => void start(prompt)}
              >
                {busy === prompt && prompt ? (
                  <LoaderCircle className="command-spin" size={15} />
                ) : (
                  <Play size={15} />
                )}
                {busy === prompt && prompt
                  ? 'Wird gestartet …'
                  : active
                    ? 'Auftrag läuft'
                    : dirty || !noteId
                      ? 'Speichern & starten'
                      : commands.some((c) => c.prompt === prompt)
                        ? 'Erneut starten'
                        : 'Auftrag starten'}
              </button>
              {prompt.length > 4000 && <small>Bitte auf 4.000 Zeichen kürzen.</small>}
            </div>
          );
        })}
      {(error || loadError) && (
        <p className="command-error" role="alert">
          {error || loadError}
        </p>
      )}
      {threads.map(({ command, resultCommand }) => {
        const active = ['pending', 'running'].includes(command.status);
        const result = resultCommand?.result;
        const previous = !!resultCommand && resultCommand.id !== command.id;
        return (
          <article className={`command-run command-${command.status}`} key={command.prompt}>
            <header>
              <span role="status">
                {active ? (
                  <LoaderCircle size={15} className="command-spin" />
                ) : command.result?.partial ||
                  (command.status === 'done' &&
                    !command.result?.items.length &&
                    !command.result?.research) ? (
                  <CircleAlert size={15} />
                ) : command.status === 'done' ? (
                  <Check size={15} />
                ) : (
                  <Square size={13} />
                )}
                {command.stage}
              </span>
              <time dateTime={command.created_at}>{readableDate(command.created_at)}</time>
              {active && (
                <button type="button" onClick={() => void cancel(command.id)}>
                  Abbrechen
                </button>
              )}
              {!active && (
                <button
                  className="command-retry"
                  type="button"
                  aria-label="Auftrag erneut ausführen"
                  title="Erneut ausführen – ersetzt das Ergebnis bei Erfolg"
                  disabled={!!busy || !connected}
                  onClick={() => void start(command.prompt)}
                >
                  {busy === command.prompt ? (
                    <LoaderCircle size={16} className="command-spin" aria-hidden="true" />
                  ) : (
                    <RotateCw size={16} aria-hidden="true" />
                  )}
                </button>
              )}
            </header>
            {active && <blockquote className="command-request">„{command.prompt}“</blockquote>}
            {command.error && <p className="command-error">{command.error}</p>}
            {previous && (
              <p className="command-previous">
                {active
                  ? 'Bisheriges Ergebnis · wird bei Erfolg ersetzt'
                  : 'Bisheriges Ergebnis · kein neues Ergebnis übernommen'}
              </p>
            )}
            {result && (
              <>
                {result.webEnabled === false && (
                  <p className="muted small">
                    Webrecherche ausgeschaltet · Antwort aus den gewählten Quellen
                  </p>
                )}
                {(!result.research || result.partial) && <p className="command-summary">{result.summary}</p>}
                {result.research && <NoteMarkdown content={result.research} scope={scope} />}
                <div className="command-results">
                  {result.items.map((item, index) => (
                    <section className="command-card" key={index}>
                      {item.imageId && (
                        <CommandImage command={resultCommand!.id} id={item.imageId} title={item.title} />
                      )}
                      <div>
                        {item.kind && (
                          <small>
                            {item.kind === 'fact'
                              ? 'Aus den Quellen'
                              : item.kind === 'inference'
                                ? 'Schlussfolgerung'
                                : 'Vorschlag'}
                          </small>
                        )}
                        <h3>{item.title}</h3>
                        {item.imageCaption && <small>{item.imageCaption}</small>}
                        <p>{item.detail}</p>
                        {item.imageError && <small>Screenshot nicht verfügbar: {item.imageError}</small>}
                        {item.url && <Sources sources={[{ title: item.title, url: item.url }]} compact />}
                        {item.citation && <CitationLink citation={item.citation} scope={scope} />}
                      </div>
                    </section>
                  ))}
                </div>
                <Sources sources={result.sources} compact />
                {onInsert && (
                  <button
                    type="button"
                    onClick={() =>
                      onInsert(
                        [
                          result.research || result.summary,
                          ...result.items.map(
                            (item) =>
                              `### ${item.title}\n\n${item.kind === 'proposal' ? 'Vorschlag: ' : item.kind === 'inference' ? 'Schlussfolgerung: ' : ''}${item.detail}${item.citation ? `\n\nQuelle: [${item.citation.title}](notes/${item.citation.noteId})${item.citation.page ? `, Seite ${item.citation.page}` : ''}${item.citation.quote ? `\n\n> ${item.citation.quote.replace(/\n/g, '\n> ')}` : ''}` : ''}`,
                          ),
                        ].join('\n\n'),
                      )
                    }
                  >
                    In Notiz übernehmen
                  </button>
                )}
                {!!result.contextSources?.length && (
                  <details className="command-sources">
                    <summary>Verwendeter Notiz- und Dokumentkontext</summary>
                    {result.contextSources
                      .filter(
                        (source, index, all) =>
                          all.findIndex(
                            (other) =>
                              other.noteId === source.noteId &&
                              other.attachment === source.attachment &&
                              other.page === source.page,
                          ) === index,
                      )
                      .map((source, index) => (
                        <CitationLink key={index} citation={source} scope={scope} />
                      ))}
                  </details>
                )}
                <details className="command-sources">
                  <summary>Auftrag & Details</summary>
                  <blockquote className="command-request">„{command.prompt}“</blockquote>
                  {!!result.warnings.length && (
                    <ul className="command-warnings">
                      {result.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {!!result.searchQueries?.length && (
                    <details className="command-sources">
                      <summary>Durchgeführte Suchanfragen</summary>
                      <ul>
                        {result.searchQueries.map((query, index) => (
                          <li key={index}>{query}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </details>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
