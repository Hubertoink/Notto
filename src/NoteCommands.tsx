import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, Play, Square } from 'lucide-react';
import { serverRequest } from './backend';
import { ownBackend, readCloudConfig } from './cloud';
import { Modal, NoteMarkdown, Sources, readableDate } from './components';
import { noteCommands, type NoteCommand } from './note-command';
import './note-commands.css';

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
}: {
  content: string;
  noteId?: string;
  scope: string;
  editing: boolean;
  dirty: boolean;
  onStart: (prompt: string, id: string) => Promise<NoteCommand>;
  onCount?: (count: number) => void;
  onCompleted?: () => Promise<void>;
}) {
  const drafts = [...new Set(noteCommands(content).map((command) => command.prompt))];
  const connected = scope !== 'local' && ownBackend();
  const [commands, setCommands] = useState<NoteCommand[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const pendingIds = useRef(new Map<string, string>());
  const startLock = useRef(false);
  const syncedCompletions = useRef(new Set<string>());
  useEffect(() => {
    onCount?.(commands.length);
  }, [commands.length, onCount]);
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
      if (!connected || !noteId || fetching) return;
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
        if (alive) setLoadError(e instanceof Error ? e.message : 'Aufträge konnten nicht geladen werden.');
      } finally {
        fetching = false;
      }
    };
    refresh.current = load;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
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
      {commands.map((command) => {
        const active = ['pending', 'running'].includes(command.status);
        return (
          <article className={`command-run command-${command.status}`} key={command.id}>
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
            </header>
            {active && <p className="command-request">{command.prompt}</p>}
            {command.error && <p className="command-error">{command.error}</p>}
            {!active && (
              <button
                type="button"
                disabled={!!busy || !connected}
                onClick={() => void start(command.prompt)}
              >
                Erneut starten
              </button>
            )}
            {command.result && (
              <>
                {!command.result.research && <p className="command-summary">{command.result.summary}</p>}
                {command.result.research && <NoteMarkdown content={command.result.research} scope={scope} />}
                <div className="command-results">
                  {command.result.items.map((item, index) => (
                    <section className="command-card" key={index}>
                      {item.imageId && (
                        <CommandImage command={command.id} id={item.imageId} title={item.title} />
                      )}
                      <div>
                        <h3>{item.title}</h3>
                        {item.imageCaption && <small>{item.imageCaption}</small>}
                        <p>{item.detail}</p>
                        {item.imageError && <small>Screenshot nicht verfügbar: {item.imageError}</small>}
                        {item.url && <Sources sources={[{ title: item.title, url: item.url }]} compact />}
                      </div>
                    </section>
                  ))}
                </div>
                <Sources sources={command.result.sources} compact />
                <details className="command-sources">
                  <summary>Auftrag & Details</summary>
                  <p>{command.prompt}</p>
                  {!!command.result.warnings.length && (
                    <ul className="command-warnings">
                      {command.result.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {!!command.result.searchQueries?.length && (
                    <details className="command-sources">
                      <summary>Durchgeführte Suchanfragen</summary>
                      <ul>
                        {command.result.searchQueries.map((query, index) => (
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
