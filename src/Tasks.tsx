import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { analyze, knowledge, type Analysis, type KnowledgeRecord, type Research } from './intelligence';
import { addTask, checkTask, newest, noteAnalysis, tasksFor, type Task } from './task-store';
import { useNotto } from './state';
import { Sources, NoteMarkdown } from './components';
import type { Note } from './domain';
import { currentContent } from './domain';
import './tasks.css';

export function useKnowledgeRecords(scope: string) {
  const [state, setState] = useState<{ scope: string; records: KnowledgeRecord[] }>({ scope, records: [] });
  const { notify } = useNotto();
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const records = await knowledge.list(scope);
        if (alive && request === generation) setState({ scope, records });
      } catch {
        if (alive) notify('Aufgaben und KI-Anmerkungen konnten nicht geladen werden.');
      }
    };
    void load();
    window.addEventListener('notto-knowledge', load);
    return () => {
      alive = false;
      window.removeEventListener('notto-knowledge', load);
    };
  }, [scope, notify]);
  return state.scope === scope ? state.records : [];
}
export function TaskRow({
  task,
  onOpen,
  small = false,
}: {
  task: Task;
  onOpen?: (id: string) => void;
  small?: boolean;
}) {
  const { scope, notify } = useNotto();
  const [busy, setBusy] = useState(false);
  return (
    <div className={`task-row ${task.done ? 'task-done' : ''} ${small ? 'task-small' : ''}`}>
      <input
        type="checkbox"
        aria-label={`${task.title} erledigt`}
        checked={task.done}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            await checkTask(scope, task, e.target.checked);
          } catch (error) {
            notify(`Aufgabe nicht gespeichert: ${String(error)}`);
          } finally {
            setBusy(false);
          }
        }}
      />
      <span className="task-title">{task.title}</span>
      {task.note && (
        <span title="Von KI vorgeschlagen" aria-label="Von KI vorgeschlagen">
          <Sparkles size={14} />
        </span>
      )}
      {!small && task.note && onOpen && (
        <button className="task-source" onClick={() => onOpen(task.note!.id)}>
          Zur Notiz
        </button>
      )}
    </div>
  );
}
export function TasksPage({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const { scope, notify } = useNotto();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="tasks-page">
      <span className="eyebrow">DEIN NOTIZBUCH</span>
      <h1>Aufgaben</h1>
      <p className="muted">
        {tasks.filter((t) => !t.done).length} offen · {tasks.filter((t) => t.done).length} erledigt.{' '}
        <Sparkles size={14} /> kennzeichnet KI-Vorschläge.
      </p>
      <form
        className="task-create"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !title.trim()) return;
          setBusy(true);
          try {
            await addTask(scope, title);
            setTitle('');
          } catch (error) {
            notify(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Eigene Aufgabe"
          placeholder="Eigene Aufgabe hinzufügen …"
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" disabled={busy || !title.trim()}>
          Hinzufügen
        </button>
      </form>
      {!tasks.length && (
        <p className="muted">Hier erscheinen eigene Aufgaben und die Vorschläge aus deinen Notizen.</p>
      )}
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onOpen={onOpen} />
      ))}
    </section>
  );
}
export function NoteAnnotations({
  note,
  hasUnsavedChanges = false,
}: {
  note: Note;
  hasUnsavedChanges?: boolean;
}) {
  const records = useKnowledgeRecords(note.scope);
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('notto-ai-sidebar') !== 'closed');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const panel = trigger.current?.closest('.detail-panel');
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setDocked(entry.contentRect.width >= 1000));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const expanded = docked ? sidebarOpen : open;
  // Keep the occupied column until AnimatePresence has removed its contents.
  // Otherwise the exiting panel participates in the collapsed auto-width track.
  const layoutExpanded = expanded || closing;
  const toggle = (next: boolean) => {
    setClosing(docked && !next);
    if (docked) {
      setSidebarOpen(next);
      localStorage.setItem('notto-ai-sidebar', next ? 'open' : 'closed');
    } else setOpen(next);
  };
  const reduced = useReducedMotion();
  const refresh = async () => {
    if (updating || hasUnsavedChanges) return;
    setUpdating(true);
    setUpdateError('');
    try {
      await analyze(note);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdating(false);
    }
  };
  const analysis = noteAnalysis(records, note);
  const items = (analysis?.data as Analysis | undefined)?.suggestions ?? [];
  const tasks = tasksFor([note], records, note.scope).filter((t) => t.note);
  const research = newest(
    records.filter((r) => r.scope === note.scope && r.noteId === note.id && r.kind === 'research'),
  );
  const seen = new Set<string>();
  const uniqueResearch = research.filter((r) => {
    const key = (r.data as { key?: string }).key ?? r.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <motion.div
      layout={!reduced && !docked}
      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      className={`note-annotations annotation-shell ${layoutExpanded ? 'annotation-open' : ''}`}
      style={{ width: layoutExpanded ? '100%' : 'fit-content' }}
    >
      <div className="annotation-heading">
        <button
          ref={trigger}
          className={`annotation-toggle ${items.length || research.length ? 'has-annotations' : ''}`}
          aria-expanded={expanded}
          onClick={() => {
            toggle(!expanded);
          }}
          title="KI-Anmerkungen direkt in der Notiz anzeigen"
        >
          <Sparkles size={17} />
          <span>KI-Anmerkungen</span>
          <span>{items.length + uniqueResearch.length || ''}</span>
        </button>
        {expanded && (
          <button
            className="annotation-close icon-button"
            aria-label="Anmerkungen schließen"
            onClick={() => {
              toggle(false);
              trigger.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false} onExitComplete={() => setClosing(false)}>
        {expanded && (
          <motion.div
            key="contents"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="annotation-panel">
              <div className="annotation-label">
                <Sparkles size={14} aria-hidden="true" />
                <span>KI-Vorschläge · separat vom Original gespeichert.</span>
              </div>
              <p className="muted annotation-update">
                {analysis && !currentContent(note, analysis.revision)
                  ? 'Die Anmerkungen beziehen sich auf eine frühere Textversion. '
                  : ''}
                <button
                  className="annotation-refresh"
                  disabled={updating || hasUnsavedChanges}
                  onClick={() => void refresh()}
                >
                  {updating ? 'Wird aktualisiert …' : 'Aktualisieren'}
                </button>
              </p>
              {hasUnsavedChanges && <p className="muted">Änderungen zuerst speichern, dann aktualisieren.</p>}
              {updateError && (
                <p role="alert" className="inline-error">
                  {updateError}
                </p>
              )}
              {!items.length && !research.length && (
                <p>
                  Noch keine Anmerkungen. Die Analyse lässt sich unter „Wissen & KI“ starten oder automatisch
                  aktivieren.
                </p>
              )}
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {items
                .filter((i) => i.kind !== 'task')
                .map((item, index) => (
                  <article key={index}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <blockquote>{item.quote}</blockquote>
                  </article>
                ))}
              {uniqueResearch.map((r) => (
                <article key={r.id}>
                  <strong>Recherche</strong>
                  <NoteMarkdown content={(r.data as Research).text} scope={note.scope} />
                  <Sources sources={(r.data as Research).sources ?? []} />
                </article>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
