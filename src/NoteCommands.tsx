import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Play, Square, WandSparkles } from 'lucide-react';
import { serverRequest } from './backend';
import { ownBackend, readCloudConfig } from './cloud';
import { Modal, readableDate } from './components';
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
  editing,
  dirty,
  onStart,
}: {
  content: string;
  noteId?: string;
  scope: string;
  editing: boolean;
  dirty: boolean;
  onStart: (prompt: string, id: string) => Promise<NoteCommand>;
}) {
  const drafts = [...new Set(noteCommands(content).map((command) => command.prompt))];
  const connected = scope !== 'local' && ownBackend();
  const [commands, setCommands] = useState<NoteCommand[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const pendingIds = useRef(new Map<string, string>());
  const startLock = useRef(false);
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
    return editing ? (
      <p className="command-hint">
        Mit <code>/ki</code> am Zeilenanfang einen KI-Auftrag formulieren. Startet erst nach deinem Klick.
      </p>
    ) : null;
  return (
    <section className="note-commands" aria-label="KI-Aufträge">
      <div className="command-heading">
        <WandSparkles size={17} />
        <strong>KI-Aufträge</strong>
        <span>Im Hintergrund</span>
      </div>
      {!connected && <p>Für Hintergrundaufträge bitte mit deinem Noto-Server anmelden.</p>}
      {drafts.map((prompt) => {
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
            <p className="command-request">{command.prompt}</p>
            <small>Verwendet die beim Start gespeicherte Notiz. Du kannst weiterschreiben.</small>
            {command.error && <p className="command-error">{command.error}</p>}
            {command.status === 'failed' && (
              <button
                type="button"
                disabled={!!busy || !connected}
                onClick={() => void start(command.prompt)}
              >
                Erneut versuchen
              </button>
            )}
            {command.result && (
              <>
                <p className="command-summary">{command.result.summary}</p>
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
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer">
                            Quelle öffnen <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
                {!!command.result.warnings.length && (
                  <ul className="command-warnings">
                    {command.result.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
                {!!command.result.sources.length && (
                  <details className="command-sources">
                    <summary>Besuchte Quellen · {command.result.sources.length}</summary>
                    <ul>
                      {command.result.sources.map((source, index) => (
                        <li key={index}>
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            {source.title || source.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
