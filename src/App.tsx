import { collectionNames, createCollection, addNoteToCollection, NOTE_DRAG_TYPE } from './collections';
import { flushSync } from 'react-dom';
import { useSidebarDisclosure } from './sidebar-disclosure';
import { FloatingSearch } from './FloatingSearch';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  FileText,
  FolderOpen,
  Hash,
  Inbox,
  Menu,
  Pin,
  Plus,
  Sparkles,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { useNotto } from './state';
import { Action, Modal } from './components';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { WebAccess } from './Login';
import { Widget } from './Widget';
import { Knowledge, IntelligenceWorker } from './Knowledge';
import './knowledge.css';
import { TasksPage, useKnowledgeRecords } from './Tasks';
import { useNewDrafts } from './drafts';
import { tasksFor } from './task-store';
import { desktop, repo } from './repository';
import { noteShortcut, newNoteLabel } from './shortcuts';
import { excerptOf, importedMarkdown, newNote, reviseNote, tagsOf, titleOf, type Note } from './domain';
import { noteBackground, readNoteBackground, type NoteBackgroundId } from './note-backgrounds';

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
  const [noteBackgroundId, setNoteBackgroundId] = useState<NoteBackgroundId>(() => readNoteBackground());
  const setNoteBackground = (id: NoteBackgroundId) => {
    setNoteBackgroundId(id);
    localStorage.setItem('notto-note-background', id);
  };
  useEffect(() => {
    const update = (e: StorageEvent) => {
      if (e.key === 'notto-theme')
        setModeState(e.newValue === 'dark' || e.newValue === 'light' ? e.newValue : 'system');
      if (e.key === 'notto-note-background') setNoteBackgroundId(readNoteBackground());
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
      <WebAccess>
        {widget ? (
          <Widget />
        ) : (
          <Notebook
            mode={mode}
            setMode={setMode}
            noteBackground={noteBackgroundId}
            setNoteBackground={setNoteBackground}
          />
        )}
      </WebAccess>
    </Theme>
  );
}

function Notebook({
  mode,
  setMode,
  noteBackground: noteBackgroundId,
  setNoteBackground,
}: {
  mode: 'system' | 'light' | 'dark';
  setMode: (m: 'system' | 'light' | 'dark') => void;
  noteBackground: NoteBackgroundId;
  setNoteBackground: (id: NoteBackgroundId) => void;
}) {
  const { notes, scope, user, loading, notify, notice, sync, syncState, syncError } = useNotto();
  const [view, setView] = useState<View>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [collectionDialog, setCollectionDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [collectionError, setCollectionError] = useState('');
  const [dragCollection, setDragCollection] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftSource, setDraftSource] = useState<'widget' | undefined>();
  const drafts = useNewDrafts(scope);
  const visibleDrafts =
    view === 'all'
      ? drafts.filter(
          (d) =>
            (!tag || tagsOf(d.content).includes(tag)) && (!collection || d.collections?.includes(collection)),
        )
      : [];
  const [settings, setSettings] = useState(false);
  const [isExpanded, toggleExpanded] = useSidebarDisclosure(scope);
  const [allTags, setAllTags] = useState(false);
  const toggleTags = (open: boolean) => {
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(() => flushSync(() => setAllTags(open)));
    } else setAllTags(open);
  };
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
    setAllTags(false);
    setCollectionDialog(false);
    setTag(null);
    setCollection(null);
    setView('all');
  }, [scope]);
  const active = notes.filter((n) => !n.deleted && !n.archived);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of active) for (const t of tagsOf(n.content)) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b, 'de'));
  }, [notes]);
  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>(collectionNames(notes, records, scope).map((name) => [name, 0]));
    for (const n of notes.filter((n) => n.scope === scope && !n.deleted && !n.archived))
      for (const name of n.collections || []) counts.set(name, (counts.get(name) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [notes, records, scope]);
  useEffect(() => {
    const openReference = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; scope: string }>).detail;
      if (
        detail?.scope !== scope ||
        !notes.some((n) => n.id === detail.id && n.scope === scope && !n.deleted)
      )
        return;
      openTaskNote(detail.id);
      setTag(null);
      setCollection(null);
      setView('all');
    };
    window.addEventListener('notto-open-note', openReference);
    return () => window.removeEventListener('notto-open-note', openReference);
  }, [notes, scope]);
  const filtered = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            (view === 'trash' ? n.deleted : !n.deleted) &&
            (view === 'archive' ? n.archived : view === 'trash' ? true : !n.archived) &&
            (view === 'pinned' ? n.pinned : true) &&
            (!tag || tagsOf(n.content).includes(tag)) &&
            (!collection || n.collections?.includes(collection)),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [notes, view, tag, collection],
  );
  const selectedNote = notes.find((n) => n.id === selected);
  const title = tasksOpen
    ? 'Aufgaben'
    : knowledgeOpen
      ? 'Wissen & KI'
      : collection
        ? collection
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
    setDraftSource(undefined);
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
      className={`nav-item ${view === id && !tag && !collection && !knowledgeOpen && !tasksOpen ? 'active' : ''}`}
      onClick={() => {
        setKnowledgeOpen(false);
        setTasksOpen(false);
        setView(id);
        setTag(null);
        setCollection(null);
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
      style={
        {
          '--nt-note-background': noteBackground(noteBackgroundId).src
            ? `url("${noteBackground(noteBackgroundId).src}")`
            : 'none',
        } as CSSProperties
      }
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
        </div>
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
        <div className="sidebar-scroll">
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
            {nav(
              'archive',
              'Archiv',
              <Archive size={17} />,
              notes.filter((n) => n.archived && !n.deleted).length,
            )}
          </nav>
          <div className="tags-heading">
            <button
              className="sidebar-disclosure"
              aria-expanded={isExpanded('tags', true)}
              onClick={() => toggleExpanded('tags', true)}
            >
              <ChevronRight size={14} />
              <span>DEINE TAGS</span>
            </button>
            <button
              className="collection-add"
              onClick={() => toggleTags(true)}
              aria-label="Alle Tags anzeigen"
            >
              <Hash size={14} />
            </button>
          </div>
          <nav className="tag-navigation" aria-label="Tags" hidden={!isExpanded('tags', true)}>
            {tagCounts.length === 0 ? (
              <p className="empty-tags">Schreibe #thema in eine Notiz. Deine Tags erscheinen hier.</p>
            ) : (
              tagCounts.slice(0, 5).map(([t, count]) => (
                <button
                  key={t}
                  className={`nav-item ${tag === t ? 'active' : ''}`}
                  onClick={() => {
                    setKnowledgeOpen(false);
                    setTasksOpen(false);
                    setTag(t);
                    setCollection(null);
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
          <div className="tags-heading">
            <button
              className="sidebar-disclosure"
              aria-expanded={isExpanded('collections', true)}
              onClick={() => toggleExpanded('collections', true)}
            >
              <ChevronRight size={14} />
              <span>SAMMLUNGEN</span>
            </button>
            <button
              className="collection-add"
              type="button"
              aria-label="Sammlung anlegen"
              title="Sammlung anlegen"
              onClick={() => {
                setNewCollectionName('');
                setCollectionError('');
                setCollectionDialog(true);
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          <nav
            className="collection-navigation"
            aria-label="Sammlungen"
            hidden={!isExpanded('collections', true)}
          >
            {collectionCounts.map(([name, count]) => (
              <div key={name} className="collection-branch">
                <div className="collection-row">
                  <button
                    className="collection-toggle sidebar-disclosure"
                    aria-label={`Sammlung ${name} ${isExpanded('collection:' + name) ? 'einklappen' : 'ausklappen'}`}
                    aria-expanded={isExpanded('collection:' + name)}
                    onClick={() => toggleExpanded('collection:' + name)}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    className={`nav-item ${collection === name && !knowledgeOpen && !tasksOpen ? 'active' : ''} ${dragCollection === name ? 'collection-drop-target' : ''}`}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setDragCollection(name);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragCollection(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragCollection(null);
                      let payload: { id?: string; scope?: string };
                      try {
                        payload = JSON.parse(e.dataTransfer.getData(NOTE_DRAG_TYPE));
                      } catch {
                        return;
                      }
                      if (
                        payload.scope !== scope ||
                        !notes.some((n) => n.id === payload.id && n.scope === scope && !n.deleted)
                      )
                        return;
                      void addNoteToCollection(scope, payload.id!, name)
                        .then(() => notify(`Zu „${name}“ hinzugefügt`))
                        .catch((error) => notify(String(error)));
                    }}
                    onClick={() => {
                      setCollection(name);
                      setTag(null);
                      setView('all');
                      setKnowledgeOpen(false);
                      setTasksOpen(false);
                      setCreating(false);
                      setSelected(null);
                      setSidebar(false);
                    }}
                  >
                    <FolderOpen size={15} />
                    <span>{name}</span>
                    <span className="nav-count">{count}</span>
                  </button>
                </div>
                {isExpanded('collection:' + name) && (
                  <div className="collection-notes">
                    {active
                      .filter((note) => note.scope === scope && note.collections?.includes(name))
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .map((note) => (
                        <button
                          key={note.id}
                          className={`nav-item ${selected === note.id ? 'active' : ''}`}
                          title={titleOf(note.content)}
                          onClick={() => {
                            setCollection(name);
                            setTag(null);
                            setView('all');
                            openTaskNote(note.id);
                          }}
                        >
                          <FileText size={14} />
                          <span>{titleOf(note.content)}</span>
                        </button>
                      ))}
                    {count === 0 && <p className="empty-tags">Noch keine Notizen</p>}
                  </div>
                )}
              </div>
            ))}
            {!collectionCounts.length && (
              <p className="empty-tags">Mit + anlegen, dann Notizen hierher ziehen.</p>
            )}
          </nav>
        </div>
        <div className="sidebar-trash">
          {nav('trash', 'Papierkorb', <Trash2 size={17} />, notes.filter((n) => n.deleted).length)}
        </div>
        <div className="sidebar-bottom">
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
          <button
            className="account-avatar"
            aria-label="Einstellungen öffnen"
            title={user?.email || 'Lokales Notizbuch'}
            onClick={() => setSettings(true)}
          >
            {user?.email?.charAt(0).toUpperCase() || 'N'}
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
            setCollection(null);
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
              setCollection(null);
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
                <h1>{title}</h1>
                <p>
                  {filtered.length} {filtered.length === 1 ? 'Notiz' : 'Notizen'}
                  {visibleDrafts.length > 0 &&
                    ` · ${visibleDrafts.length} ${visibleDrafts.length === 1 ? 'Entwurf' : 'Entwürfe'}`}
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
              {visibleDrafts.map((draft) => (
                <button
                  key={draft.key}
                  className={`note-card ${creating && (draftSource ?? null) === draft.noteId ? 'selected' : ''}`}
                  onClick={() => {
                    setDraftSource(draft.noteId === 'widget' ? 'widget' : undefined);
                    setSelected(null);
                    setCreating(true);
                  }}
                >
                  <div className="note-card-meta">
                    <span className="draft-label">Entwurf · lokal</span>
                  </div>
                  <h2>{titleOf(draft.content)}</h2>
                  <p>{excerptOf(draft.content).slice(0, 155)}</p>
                </button>
              ))}
              {loading ? (
                <div className="list-empty">Notizen werden geladen …</div>
              ) : filtered.length === 0 && visibleDrafts.length === 0 ? (
                <div className="list-empty">
                  <FileText size={28} strokeWidth={1.3} />
                  <strong>
                    {view === 'trash'
                      ? 'Dein Papierkorb ist leer'
                      : collection
                        ? 'Diese Sammlung ist noch leer'
                        : view === 'archive'
                          ? 'Noch nichts archiviert'
                          : 'Hier beginnt dein Notizbuch'}
                  </strong>
                  <p>
                    {collection
                      ? 'Ziehe Notizen auf die Sammlung oder lege hier eine neue Notiz an.'
                      : 'Halte einen Gedanken fest. Die Ordnung kann später kommen.'}
                  </p>
                  {view === 'all' && (
                    <Action label="Erste Notiz schreiben" icon={<Plus size={16} />} onClick={openNew} />
                  )}
                </div>
              ) : (
                filtered.map((n) => (
                  <button
                    key={n.id}
                    className={`note-card ${selected === n.id && !creating ? 'selected' : ''}`}
                    draggable={!n.deleted}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(NOTE_DRAG_TYPE, JSON.stringify({ id: n.id, scope }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDragEnd={() => setDragCollection(null)}
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
                <button
                  type="button"
                  className="mobile-back icon-button"
                  aria-label="Zur Notizliste"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft size={20} />
                </button>
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
                key={`${scope}:${creating ? (draftSource ?? 'new') : selectedNote!.id}`}
                draftSource={creating ? draftSource : undefined}
                note={creating ? undefined : selectedNote}
                initialCollections={creating && collection ? [collection] : []}
                onBack={() => {
                  setSelected(null);
                  setCreating(false);
                }}
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
      {collectionDialog && (
        <Modal
          title="Sammlung anlegen"
          onClose={() => {
            if (!collectionBusy) setCollectionDialog(false);
          }}
        >
          <form
            className="new-collection-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (collectionBusy || !newCollectionName.trim()) return;
              setCollectionBusy(true);
              setCollectionError('');
              const existing = collectionNames(notes, records, scope).find(
                (n) => n.toLocaleLowerCase('de') === newCollectionName.trim().toLocaleLowerCase('de'),
              );
              void createCollection(scope, existing || newCollectionName)
                .then((name) => {
                  setCollection(name);
                  setView('all');
                  setTag(null);
                  setKnowledgeOpen(false);
                  setTasksOpen(false);
                  setCreating(false);
                  setSelected(null);
                  setCollectionDialog(false);
                  setSidebar(false);
                })
                .catch((error) => setCollectionError(String(error)))
                .finally(() => setCollectionBusy(false));
            }}
          >
            <label>
              Name
              <input
                autoFocus
                aria-label="Name der Sammlung"
                value={newCollectionName}
                maxLength={60}
                placeholder="Zum Beispiel Jugendhaus"
                onChange={(e) => setNewCollectionName(e.target.value)}
                disabled={collectionBusy}
              />
            </label>
            <p className="muted small">Ziehe anschließend Notizen aus „Alle Notizen“ auf die Sammlung.</p>
            {collectionError && (
              <p role="alert" className="inline-error">
                {collectionError}
              </p>
            )}
            <button
              className="collection-submit"
              type="submit"
              disabled={collectionBusy || !newCollectionName.trim()}
            >
              {collectionBusy ? 'Wird angelegt …' : 'Sammlung anlegen'}
            </button>
          </form>
        </Modal>
      )}
      {allTags && (
        <Modal title="Deine Tags" onClose={() => toggleTags(false)}>
          <div className="all-tags" style={{ viewTransitionName: 'tags-popout' }}>
            {tagCounts.map(([name, count]) => (
              <button
                className="nav-item"
                key={name}
                onClick={() => {
                  setTag(name);
                  setCollection(null);
                  setView('all');
                  setKnowledgeOpen(false);
                  setTasksOpen(false);
                  setSelected(null);
                  setCreating(false);
                  setAllTags(false);
                  setCollectionDialog(false);
                  setSidebar(false);
                }}
              >
                <Hash size={16} />
                <span>{name}</span>
                <span className="nav-count">{count}</span>
              </button>
            ))}
            {!tagCounts.length && <p>Schreibe #thema in eine Notiz, um einen Tag anzulegen.</p>}
          </div>
        </Modal>
      )}
      {settings && (
        <Settings
          onImport={() => {
            setSettings(false);
            importInput.current?.click();
          }}
          mode={mode}
          setMode={setMode}
          noteBackground={noteBackgroundId}
          setNoteBackground={setNoteBackground}
          onClose={() => setSettings(false)}
        />
      )}
      <IntelligenceWorker />
    </div>
  );
}
function PenGlyph() {
  return <FileText size={32} strokeWidth={1.25} />;
}
