import { FloatingSearch } from './FloatingSearch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  FileText,
  Hash,
  Inbox,
  Menu,
  Pin,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { useNotto } from './state';
import { Action } from './components';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { WebAccess } from './Login';
import { Widget } from './Widget';
import { Knowledge, IntelligenceWorker } from './Knowledge';
import './knowledge.css';
import { TasksPage, TaskRow, useKnowledgeRecords } from './Tasks';
import { tasksFor } from './task-store';
import { desktop, repo } from './repository';
import { noteShortcut, newNoteLabel } from './shortcuts';
import { excerptOf, importedMarkdown, newNote, reviseNote, tagsOf, titleOf, type Note } from './domain';

type View = 'all' | 'pinned' | 'archive' | 'trash';
export default function App() {
  const [mode, setModeState] = useState<'system' | 'light' | 'dark'>(() => {
    const m = localStorage.getItem('notto-theme');
    return m === 'dark' || m === 'light' ? m : 'system';
  });
  const setMode = (m: typeof mode) => {
    setModeState(m);
    localStorage.setItem('notto-theme', m);
  };
  useEffect(() => {
    const update = (e: StorageEvent) => {
      if (e.key === 'notto-theme')
        setModeState(e.newValue === 'dark' || e.newValue === 'light' ? e.newValue : 'system');
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const widget = new URLSearchParams(location.search).get('window') === 'widget';
  useEffect(() => {
    document.documentElement.classList.toggle('widget-document', widget && desktop);
  }, [widget]);
  return (
    <Theme theme={neutralTheme} mode={mode}>
      <WebAccess>{widget ? <Widget /> : <Notebook mode={mode} setMode={setMode} />}</WebAccess>
    </Theme>
  );
}

function Notebook({
  mode,
  setMode,
}: {
  mode: 'system' | 'light' | 'dark';
  setMode: (m: 'system' | 'light' | 'dark') => void;
}) {
  const { notes, scope, user, loading, notify, notice, sync, syncState, syncError } = useNotto();
  const [view, setView] = useState<View>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const records = useKnowledgeRecords(scope);
  const tasks = tasksFor(notes, records, scope);
  const openTaskNote = (id: string) => {
    setTasksOpen(false);
    setKnowledgeOpen(false);
    setCreating(false);
    setSelected(id);
    setSidebar(false);
  };
  const [sidebar, setSidebar] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelected(null);
    setKnowledgeOpen(false);
    setTasksOpen(false);
    setCreating(false);
    setSearchOpen(false);
    setTag(null);
    setView('all');
  }, [scope]);
  const active = notes.filter((n) => !n.deleted && !n.archived);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of active) for (const t of tagsOf(n.content)) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [notes]);
  const filtered = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            (view === 'trash' ? n.deleted : !n.deleted) &&
            (view === 'archive' ? n.archived : view === 'trash' ? true : !n.archived) &&
            (view === 'pinned' ? n.pinned : true) &&
            (!tag || tagsOf(n.content).includes(tag)),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [notes, view, tag],
  );
  const selectedNote = notes.find((n) => n.id === selected);
  const title = tasksOpen
    ? 'Aufgaben'
    : knowledgeOpen
      ? 'Wissen & KI'
      : tag
        ? `#${tag}`
        : view === 'pinned'
          ? 'Angeheftet'
          : view === 'archive'
            ? 'Archiv'
            : view === 'trash'
              ? 'Papierkorb'
              : 'Alle Notizen';
  const openNew = () => {
    setKnowledgeOpen(false);
    setTasksOpen(false);
    setSelected(null);
    setCreating(true);
    setSidebar(false);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        e.isComposing ||
        document.querySelector('[role="dialog"], dialog[open]')
      )
        return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (noteShortcut(e, desktop)) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let closed = false;
    listen<string | null>('open-note', (e) => {
      if (e.payload) {
        setKnowledgeOpen(false);
        setTasksOpen(false);
        setCreating(false);
        setSelected(e.payload);
      } else openNew();
    }).then((fn) => (closed ? fn() : (dispose = fn)));
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);
  async function patch(n: Note, values: Parameters<typeof reviseNote>[1]) {
    try {
      await repo.put(reviseNote(n, values), n.revision);
      notify(
        values.deleted
          ? 'In den Papierkorb verschoben'
          : values.deleted === false
            ? 'Notiz wiederhergestellt'
            : 'Notiz aktualisiert',
      );
    } catch (e) {
      notify(String(e));
    }
  }
  async function importNotes(files: File[]) {
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Eine Textdatei darf höchstens 5 MB groß sein.');
        const note = newNote(scope, importedMarkdown(await file.text()));
        await repo.put(note, null);
        setSelected(note.id);
        setCreating(false);
      }
      notify(`${files.length} Notiz(en) importiert`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }
  const nav = (id: View, label: string, icon: React.ReactNode, count: number) => (
    <button
      className={`nav-item ${view === id && !tag && !knowledgeOpen && !tasksOpen ? 'active' : ''}`}
      onClick={() => {
        setKnowledgeOpen(false);
        setTasksOpen(false);
        setView(id);
        setTag(null);
        setSidebar(false);
        setCreating(false);
        setSelected(null);
      }}
    >
      {icon}
      <span>{label}</span>
      <span className="nav-count">{count || ''}</span>
    </button>
  );
  return (
    <div
      data-note-overview={!selected && !creating && !knowledgeOpen && !tasksOpen}
      className={`notebook ${sidebar ? 'sidebar-open' : ''} ${selected || creating ? 'detail-open' : ''}`}
    >
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Navigation schließen"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/noto.png" alt="" />
          <span>noto</span>
          <button
            className="workspace-button"
            aria-label="Kontoeinstellungen"
            onClick={() => setSettings(true)}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <button className="workspace" onClick={() => setSettings(true)}>
          <span className="workspace-avatar">{user?.email?.charAt(0).toUpperCase() || 'N'}</span>
          <span>
            <strong>{user ? 'Mein Notizbuch' : 'Lokales Notizbuch'}</strong>
            <small>{user?.email || 'Nur auf diesem Gerät'}</small>
          </span>
        </button>
        <div className="sidebar-new">
          <Action
            label="Neue Notiz"
            endContent={
              <kbd className="note-shortcut" aria-label={newNoteLabel}>
                {desktop ? newNoteLabel : 'Strg ⇧ ␣'}
              </kbd>
            }
            tooltip={`Neue Notiz · ${newNoteLabel}`}
            icon={<Plus size={18} />}
            variant="primary"
            width="100%"
            onClick={openNew}
          />
        </div>
        <nav aria-label="Notizbücher">
          {nav('all', 'Alle Notizen', <Inbox size={18} />, active.length)}
          {nav('pinned', 'Angeheftet', <Pin size={17} />, active.filter((n) => n.pinned).length)}
          <button
            className={`nav-item ${knowledgeOpen ? 'active' : ''}`}
            aria-current={knowledgeOpen ? 'page' : undefined}
            onClick={() => {
              setKnowledgeOpen(true);
              setTasksOpen(false);
              setSidebar(false);
            }}
          >
            <Sparkles size={18} />
            <span>Wissen & KI</span>
          </button>
          <button
            className={`nav-item ${tasksOpen ? 'active' : ''}`}
            aria-current={tasksOpen ? 'page' : undefined}
            onClick={() => {
              setTasksOpen(true);
              setKnowledgeOpen(false);
              setSidebar(false);
            }}
          >
            <Check size={18} />
            <span>Aufgaben</span>
            <span className="nav-count">{tasks.filter((t) => !t.done).length || ''}</span>
          </button>
          <div className="sidebar-tasks" aria-label="Offene Aufgaben">
            {tasks
              .filter((t) => !t.done)
              .map((task) => (
                <TaskRow key={task.id} task={task} small />
              ))}
          </div>
          {nav(
            'archive',
            'Archiv',
            <Archive size={17} />,
            notes.filter((n) => n.archived && !n.deleted).length,
          )}
        </nav>
        <div className="tags-heading">
          <span>DEINE TAGS</span>
          <Hash size={13} />
        </div>
        <nav className="tag-navigation" aria-label="Tags">
          {tagCounts.length === 0 ? (
            <p className="empty-tags">Schreibe #thema in eine Notiz. Deine Tags erscheinen hier.</p>
          ) : (
            tagCounts.map(([t, count]) => (
              <button
                key={t}
                className={`nav-item ${tag === t ? 'active' : ''}`}
                onClick={() => {
                  setKnowledgeOpen(false);
                  setTasksOpen(false);
                  setTag(t);
                  setView('all');
                  setCreating(false);
                  setSelected(null);
                  setSidebar(false);
                }}
              >
                <Hash size={15} />
                <span>{t}</span>
                <span className="nav-count">{count}</span>
              </button>
            ))
          )}
        </nav>
        <div className="sidebar-bottom">
          {nav('trash', 'Papierkorb', <Trash2 size={17} />, notes.filter((n) => n.deleted).length)}
          <button className="nav-item" onClick={() => importInput.current?.click()}>
            <Upload size={17} />
            <span>Markdown importieren</span>
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".md,.markdown,.txt"
            multiple
            hidden
            onChange={(e) => {
              void importNotes(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button className="nav-item" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
            <span>Einstellungen</span>
          </button>
          <button
            className={`sync-indicator ${syncState === 'error' ? 'sync-error' : ''}`}
            onClick={() => (user ? void sync() : setSettings(true))}
            title={syncError || undefined}
          >
            {syncState === 'local' ? (
              <CloudOff size={15} />
            ) : syncState === 'offline' ? (
              <WifiOff size={15} />
            ) : syncState === 'synced' ? (
              <Check size={15} />
            ) : (
              <Cloud size={15} />
            )}
            <span>
              {
                {
                  local: 'Lokal gespeichert',
                  offline: 'Offline · lokal gespeichert',
                  syncing: 'Synchronisiert …',
                  synced: 'Synchronisiert',
                  error: 'Synchronisation prüfen',
                }[syncState]
              }
            </span>
          </button>
        </div>
      </aside>
      <main className="main">
        <button
          className="mobile-menu icon-button floating-menu"
          aria-label="Navigation öffnen"
          onClick={() => setSidebar(true)}
        >
          <Menu size={20} />
        </button>
        <FloatingSearch
          scope={scope}
          key={scope}
          open={searchOpen}
          onOpen={() => setSearchOpen(true)}
          onClose={() => setSearchOpen(false)}
          notes={notes}
          onSelect={(id) => {
            openTaskNote(id);
            setView('all');
            setTag(null);
          }}
        />

        <div className="knowledge-page" hidden={!knowledgeOpen}>
          <Knowledge
            key={scope}
            active={knowledgeOpen}
            onOpen={(id) => {
              setKnowledgeOpen(false);
              setTasksOpen(false);
              setCreating(false);
              setSelected(id);
              setView('all');
              setTag(null);
            }}
          />
        </div>
        <div className="tasks-workspace" hidden={!tasksOpen}>
          <TasksPage key={scope} tasks={tasks} onOpen={openTaskNote} />
        </div>
        <div className="work-area" hidden={knowledgeOpen || tasksOpen}>
          <section className="note-list-panel">
            <div className="list-heading">
              <div>
                <span className="eyebrow">DEIN NOTIZBUCH</span>
                <h1>{title}</h1>
                <p>
                  {filtered.length} {filtered.length === 1 ? 'Notiz' : 'Notizen'}
                </p>
              </div>
              <Action
                label="Neue Notiz"
                tooltip={`Neue Notiz · ${newNoteLabel}`}
                icon={<Plus size={19} />}
                isIconOnly
                variant="ghost"
                onClick={openNew}
              />
            </div>
            <div className="note-list">
              {loading ? (
                <div className="list-empty">Notizen werden geladen …</div>
              ) : filtered.length === 0 ? (
                <div className="list-empty">
                  <FileText size={28} strokeWidth={1.3} />
                  <strong>
                    {view === 'trash'
                      ? 'Dein Papierkorb ist leer'
                      : view === 'archive'
                        ? 'Noch nichts archiviert'
                        : 'Hier beginnt dein Notizbuch'}
                  </strong>
                  <p>Halte einen Gedanken fest. Die Ordnung kann später kommen.</p>
                  {view === 'all' && (
                    <Action label="Erste Notiz schreiben" icon={<Plus size={16} />} onClick={openNew} />
                  )}
                </div>
              ) : (
                filtered.map((n) => (
                  <button
                    key={n.id}
                    className={`note-card ${selected === n.id && !creating ? 'selected' : ''}`}
                    onClick={() => {
                      setSelected(n.id);
                      setCreating(false);
                    }}
                  >
                    <div className="note-card-meta">
                      <span>
                        {new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(
                          new Date(n.updatedAt),
                        )}
                      </span>
                      {n.pinned && <Pin size={13} />}
                    </div>
                    <h2>{titleOf(n.content)}</h2>
                    <p>{excerptOf(n.content).slice(0, 155)}</p>
                    <div className="note-card-tags">
                      {tagsOf(n.content)
                        .slice(0, 3)
                        .map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                      {n.conflictOf && <span className="conflict-label">Konfliktkopie</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
          <section className="detail-panel">
            {(selectedNote || creating) && (
              <div className="detail-actions">
                <button
                  className="mobile-back text-button"
                  onClick={() => {
                    setSelected(null);
                    setCreating(false);
                  }}
                >
                  <ArrowLeft size={16} /> Zurück
                </button>
                <span>{selectedNote?.deleted ? 'Im Papierkorb' : ''}</span>
                <div className="toolbar">
                  {selectedNote && !selectedNote.deleted && (
                    <>
                      <Action
                        label={selectedNote.pinned ? 'Loslösen' : 'Anheften'}
                        icon={<Pin size={16} />}
                        isIconOnly
                        variant="ghost"
                        onClick={() => void patch(selectedNote, { pinned: !selectedNote.pinned })}
                      />
                      <Action
                        label={selectedNote.archived ? 'Aus Archiv holen' : 'Archivieren'}
                        icon={<Archive size={16} />}
                        isIconOnly
                        variant="ghost"
                        onClick={() => void patch(selectedNote, { archived: !selectedNote.archived })}
                      />
                      <Action
                        label="In den Papierkorb"
                        icon={<Trash2 size={16} />}
                        isIconOnly
                        variant="ghost"
                        onClick={() => void patch(selectedNote, { deleted: true })}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
            {selectedNote?.deleted ? (
              <div className="welcome">
                <Trash2 size={32} />
                <h2>Im Papierkorb aufbewahrt.</h2>
                <p>Diese Notiz und ihre bisherigen Versionen sind noch vorhanden.</p>
                <Action
                  label="Notiz wiederherstellen"
                  variant="primary"
                  onClick={() => void patch(selectedNote, { deleted: false })}
                />
              </div>
            ) : creating || selectedNote ? (
              <Editor
                key={`${scope}:${creating ? 'new' : selectedNote!.id}`}
                note={creating ? undefined : selectedNote}
                onSaved={(n) => {
                  setSelected(n.id);
                  setCreating(false);
                }}
              />
            ) : (
              <div className="welcome">
                <div className="welcome-symbol">
                  <PenGlyph />
                </div>
                <span className="eyebrow">PLATZ FÜR DEINE GEDANKEN</span>
                <h2>
                  Kleine Notiz.
                  <br />
                  Klarer Kopf.
                </h2>
                <p>
                  Ideen, Begegnungen, Dinge für später.
                  <br />
                  Alles beginnt mit einem Gedanken.
                </p>
                <Action
                  label="Etwas festhalten"
                  icon={<Plus size={18} />}
                  variant="primary"
                  onClick={openNew}
                />
                <span className="welcome-shortcut">{newNoteLabel} für eine neue Notiz</span>
              </div>
            )}
          </section>
        </div>
      </main>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Check size={17} />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
      {settings && <Settings mode={mode} setMode={setMode} onClose={() => setSettings(false)} />}
      <IntelligenceWorker />
    </div>
  );
}
function PenGlyph() {
  return <FileText size={32} strokeWidth={1.25} />;
}
