import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { Sparkles, X, WandSparkles, RefreshCw } from 'lucide-react';
import { analyze, config, knowledge, type KnowledgeRecord, type Research } from './intelligence';
import { noteExclusionReason } from './evidence-policy';
import { addTask, checkTask, newest, noteAnalysis, tasksFor, type Task } from './task-store';
import { useNotto } from './state';
import { Sources, NoteMarkdown } from './components';
import type { Note } from './domain';
import { currentContent } from './domain';
import { aiAnnotationBackgrounds } from './note-backgrounds';
import { compactParenthesizedLines } from './annotation-markdown';
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
  onRewrite,
  aiBackgroundEnabled = false,
}: {
  note: Note;
  hasUnsavedChanges?: boolean;
  onRewrite?: (instruction: string) => void;
  aiBackgroundEnabled?: boolean;
}) {
  const records = useKnowledgeRecords(note.scope);
  const excluded = noteExclusionReason(note, config(note.scope));
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('notto-ai-sidebar') !== 'closed');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [aiBackground, setAiBackground] = useState<string | null>(() =>
    aiBackgroundEnabled
      ? aiAnnotationBackgrounds[Math.floor(Math.random() * aiAnnotationBackgrounds.length)]
      : null,
  );
  useEffect(() => {
    setAiBackground(
      aiBackgroundEnabled
        ? aiAnnotationBackgrounds[Math.floor(Math.random() * aiAnnotationBackgrounds.length)]
        : null,
    );
  }, [aiBackgroundEnabled]);
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
      className={`note-annotations annotation-shell ${layoutExpanded ? 'annotation-open' : ''} ${aiBackground && expanded ? 'has-ai-background' : ''}`}
      style={
        {
          width: layoutExpanded ? '100%' : 'fit-content',
          ...(aiBackground ? { '--ai-annotation-background': `url("${aiBackground}")` } : {}),
        } as CSSProperties
      }
    >
      <div className="annotation-heading">
        <button
          ref={trigger}
          className={`annotation-toggle ${tasks.length || uniqueResearch.length ? 'has-annotations' : ''}`}
          aria-expanded={expanded}
          onClick={() => {
            toggle(!expanded);
          }}
          title="KI-Anmerkungen direkt in der Notiz anzeigen"
        >
          <Sparkles size={17} />
          <span>KI-Anmerkungen</span>
          <span>{tasks.length + uniqueResearch.length || ''}</span>
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
              {excluded && <p className="inline-error">{excluded}</p>}
              <div className="annotation-actions">
                {onRewrite && (
                  <button className="annotation-command" disabled={!!excluded} onClick={() => onRewrite('')}>
                    <WandSparkles size={16} /> Notiz überarbeiten
                  </button>
                )}
                <button
                  className="annotation-command annotation-command-secondary"
                  disabled={updating || hasUnsavedChanges || !!excluded}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} />
                  {updating ? 'Wird aktualisiert …' : 'Aktualisieren'}
                </button>
              </div>
              {analysis && !currentContent(note, analysis.revision) && (
                <p className="muted small">Anmerkungen zur früheren Textversion.</p>
              )}
              {hasUnsavedChanges && <p className="muted">Änderungen zuerst speichern, dann aktualisieren.</p>}
              {updateError && (
                <p role="alert" className="inline-error">
                  {updateError}
                </p>
              )}
              {!excluded && !tasks.length && !uniqueResearch.length && (
                <p className="annotation-empty">
                  Keine offenen Hinweise. Hier erscheinen Aufgaben und Rechercheergebnisse.
                </p>
              )}
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {uniqueResearch.map((r) => (
                <article key={r.id}>
                  <strong>Recherche</strong>
                  <NoteMarkdown
                    content={compactParenthesizedLines((r.data as Research).text)}
                    scope={note.scope}
                  />
                  <Sources sources={(r.data as Research).sources ?? []} compact />
                </article>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
