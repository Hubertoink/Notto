import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { Sparkles, X, WandSparkles, RefreshCw, Globe, ListTodo, Link2, FileText } from 'lucide-react';
import {
  analyze,
  research as researchNote,
  config,
  knowledge,
  type Analysis,
  type Evidence,
  type KnowledgeRecord,
  type Research,
} from './intelligence';
import { noteExclusionReason } from './evidence-policy';
import { addTask, checkTask, newest, noteAnalysis, tasksFor, type Task } from './task-store';
import { useNotto } from './state';
import { Sources, NoteMarkdown } from './components';
import type { Note } from './domain';
import { attachmentIds, currentContent, titleOf } from './domain';
import { aiAnnotationBackgrounds } from './note-backgrounds';
import { compactParenthesizedLines } from './annotation-markdown';
import './tasks.css';
import { RelationSuggestions } from './RelationSuggestions';
import { visibleRelations, linkedTo, relationKey, type RelationBatch, type Relation } from './note-relations';
import { eligible } from './intelligence';
import { AttachmentTitle } from './AttachmentTitle';

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
      <p className="muted">
        Hake Aufgaben ab, wenn sie erledigt sind oder du sie nicht weiterverfolgen möchtest.
        Rechercheergebnisse bleiben in den KI-Anmerkungen erhalten.
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
  onAcceptRelation,
}: {
  note: Note;
  hasUnsavedChanges?: boolean;
  onRewrite?: (instruction: string) => void;
  aiBackgroundEnabled?: boolean;
  onAcceptRelation?: (r: Relation) => Promise<void>;
}) {
  const { notes = [] } = useNotto();
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
  const refresh = async (web = false) => {
    if (updating || hasUnsavedChanges) return;
    setUpdating(true);
    setUpdateError('');
    try {
      if (web)
        await researchNote(note, {
          kind: 'topic',
          title: titleOf(note.content),
          detail: note.content,
          quote: note.content.slice(0, 4000),
        });
      else await analyze(note);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdating(false);
    }
  };
  const analysis = noteAnalysis(records, note);
  const insights =
    analysis && currentContent(note, analysis.revision)
      ? ((analysis.data as Analysis).suggestions || [])
          .filter((item) => item.kind === 'insight')
          .map((item) => ({
            item,
            source: records
              .filter((record) => record.kind === 'extraction' && record.noteId === note.id)
              .sort((a, b) => b.at.localeCompare(a.at))
              .flatMap((record) => (record.data as { pages: Evidence[] }).pages || [])
              .find(
                (page) =>
                  page.attachment?.endsWith('.pdf') &&
                  attachmentIds(note.content).includes(page.attachment) &&
                  page.text.includes(item.quote),
              ),
          }))
      : [];
  const relations = visibleRelations(note, notes.filter(eligible), records);
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
  const acceptedKeys = new Set(
    records
      .filter(
        (r) =>
          r.scope === note.scope &&
          r.kind === 'relation-decision' &&
          (r.data as { status: string }).status === 'accepted',
      )
      .map((r) => (r.data as { key: string }).key),
  );
  const acceptedLinks = new Set(
    records
      .filter((r) => r.scope === note.scope && r.kind === 'note-relations')
      .flatMap((r) => (r.data as RelationBatch).suggestions || [])
      .filter(
        (r) =>
          r.sourceId === note.id &&
          acceptedKeys.has(relationKey(r)) &&
          linkedTo(note, r.targetId) &&
          notes.some((n) => n.id === r.targetId && !n.deleted),
      )
      .map((r) => r.targetId),
  ).size;
  const indicators = [
    { Icon: Globe, count: uniqueResearch.length, label: 'Recherche vorhanden', state: 'complete' },
    { Icon: ListTodo, count: tasks.filter((t) => !t.done).length, label: 'Aufgaben offen', state: 'pending' },
    {
      Icon: ListTodo,
      count: tasks.filter((t) => t.done).length,
      label: 'Aufgaben erledigt',
      state: 'complete',
    },
    { Icon: Link2, count: relations.length, label: 'Verlinkungen offen', state: 'pending' },
    { Icon: Link2, count: acceptedLinks, label: 'Verlinkungen übernommen', state: 'complete' },
    { Icon: FileText, count: insights.length, label: 'PDF-Anmerkungen vorhanden', state: 'complete' },
  ].filter((indicator) => indicator.count > 0);
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
          className={`annotation-toggle ${indicators.length ? 'has-annotations' : ''}`}
          aria-expanded={expanded}
          onClick={() => {
            toggle(!expanded);
          }}
          title="KI-Anmerkungen direkt in der Notiz anzeigen"
        >
          <Sparkles size={17} />
          <span>KI-Anmerkungen</span>
          {indicators.map(({ Icon, count, label, state }) => (
            <span
              key={label}
              className={`annotation-indicator ${state}`}
              title={`${label}: ${count}`}
              aria-label={`${label}: ${count}`}
            >
              <Icon size={16} aria-hidden="true" /> <span>{count}</span>
              <span className="annotation-indicator-label">{label}</span>
            </span>
          ))}
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
              <div className="annotation-status-list" aria-label="Anmerkungen nach Kategorie">
                {indicators.map(({ Icon, count, label, state }) => (
                  <span key={label} className={`annotation-indicator ${state}`}>
                    <Icon size={16} aria-hidden="true" />
                    {count} {label}
                  </span>
                ))}
              </div>
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
                <button
                  className="annotation-command annotation-command-secondary"
                  disabled={updating || hasUnsavedChanges || !!excluded}
                  onClick={() => void refresh(true)}
                >
                  <Globe size={15} /> Webrecherche starten
                </button>
              </div>
              <p className="muted small">
                Aktualisieren analysiert diese Notiz erneut. Webrecherche ergänzt Hintergrundwissen zu ihren
                Themen und Links mit Quellen.
              </p>
              {analysis && !currentContent(note, analysis.revision) && (
                <p className="muted small">Anmerkungen zur früheren Textversion.</p>
              )}
              {hasUnsavedChanges && <p className="muted">Änderungen zuerst speichern, dann aktualisieren.</p>}
              {updateError && (
                <p role="alert" className="inline-error">
                  {updateError}
                </p>
              )}
              {!excluded &&
                !tasks.length &&
                !insights.length &&
                !uniqueResearch.length &&
                !relations.length && (
                  <p className="annotation-empty">
                    Keine offenen Hinweise. Hier erscheinen passende Notizen, Aufgaben, PDF-Anmerkungen und
                    Rechercheergebnisse.
                  </p>
                )}
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {!excluded &&
                insights.map(({ item, source }, index) => (
                  <article className="pdf-insight" key={`${item.quote}:${index}`}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <blockquote>{item.quote}</blockquote>
                    {source?.attachment && (
                      <small>
                        <AttachmentTitle content={note.content} id={source.attachment} scope={note.scope} />
                        {source.page ? ` · Seite ${source.page}` : ''}
                      </small>
                    )}
                  </article>
                ))}
              {!excluded && (
                <RelationSuggestions
                  note={note}
                  notes={notes}
                  records={records}
                  disabled={hasUnsavedChanges}
                  onAccept={onAcceptRelation}
                />
              )}
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
