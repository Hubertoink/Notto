import {
  backlinks,
  linkedNotes,
  noteLink,
  formatText,
  normalizeCollections,
  type Format,
} from './note-tools';
import { createPortal } from 'react-dom';
import { AttachmentTitle } from './AttachmentTitle';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  WandSparkles,
  Undo2,
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Link,
  FileSymlink,
  FolderOpen,
  Check,
  Eye,
  History,
  ImagePlus,
  PenLine,
  Save,
  X,
} from 'lucide-react';
import { Action, Modal, NoteMarkdown, NoteReferenceLink, readableDate } from './components';
import { newNote, reviseNote, tagsOf, attachmentIds, titleOf, type Note, type Revision } from './domain';
import { PdfAttachment } from './PdfAttachment';
import { repo } from './repository';
import { useNotto } from './state';
import { Dictation } from './Dictation';
import { NoteAnnotations, useKnowledgeRecords } from './Tasks';
import { collectionNames, createCollection } from './collections';
import { rewriteNote } from './rewrite';

export function Editor({
  note,
  compact = false,
  draftSource,
  initialCollections = [],
  onSaved,
  onBack,
  onClose,
}: {
  note?: Note;
  compact?: boolean;
  draftSource?: 'widget';
  initialCollections?: string[];
  onSaved: (note: Note) => void;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const { scope, notify, notes } = useNotto();
  const collectionRecords = useKnowledgeRecords(scope);
  const knownCollections = collectionNames(notes || [], collectionRecords, scope);
  const [content, setContent] = useState(note?.content ?? '');
  const [collections, setCollections] = useState(note?.collections || initialCollections);
  const collectionRef = useRef(collections);
  const initialCollectionRef = useRef(collections);
  const [collectionInput, setCollectionInput] = useState('');
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(Boolean(note) && !compact);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteUndo, setRewriteUndo] = useState<{ before: string; after: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingImages, setAddingImages] = useState(0);
  const imageOperations = useRef(0);
  const [draftStatus, setDraftStatus] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editGeneration = useRef(0);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [oldRevision, setOldRevision] = useState<Revision | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const acceptedTagCaret = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    if (acceptedTagCaret.current === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(acceptedTagCaret.current.start, acceptedTagCaret.current.end);
    acceptedTagCaret.current = null;
  }, [content, collections]);
  const [tagToken, setTagToken] = useState<{
    start: number;
    end: number;
    query: string;
    kind: 'tag' | 'note';
  } | null>(null);
  const [tagIndex, setTagIndex] = useState(0);
  const [tagPosition, setTagPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !tagToken || preview) {
      setTagPosition(null);
      return;
    }
    // Mirror the textarea's typography and wrapping to locate the active hashtag.
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mirror);
    const update = () => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-variant',
        'line-height',
        'letter-spacing',
        'word-spacing',
        'text-transform',
        'text-indent',
        'text-align',
        'tab-size',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'direction',
      ]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      Object.assign(mirror.style, {
        position: 'fixed',
        visibility: 'hidden',
        pointerEvents: 'none',
        left: '0',
        top: '0',
        width: `${el.clientWidth}px`,
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        border: '0',
      });
      const marker = document.createElement('span');
      marker.textContent = el.value.slice(tagToken.start, tagToken.end) || '#';
      mirror.replaceChildren(
        document.createTextNode(el.value.slice(0, tagToken.start)),
        marker,
        document.createTextNode(el.value.slice(tagToken.end)),
      );
      const bounds = marker.getClientRects()[0] || marker.getBoundingClientRect();
      const left = rect.left + el.clientLeft + bounds.left - el.scrollLeft;
      const top = rect.top + el.clientTop + bounds.bottom - el.scrollTop + 4;
      if (top < rect.top || top > rect.bottom + 4 || top >= window.innerHeight - 12) {
        setTagPosition(null);
        return;
      }
      setTagPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - 228)),
        top,
        maxHeight: Math.max(0, Math.min(200, window.innerHeight - top - 8)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      mirror.remove();
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [tagToken, content, preview]);
  const tagOptions = [
    ...new Set(
      (notes || [])
        .filter((n) => n.scope === scope && !n.deleted)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .flatMap((n) => tagsOf(n.content)),
    ),
  ]
    .filter((t) => t.toLocaleLowerCase('de').startsWith(tagToken?.query.toLocaleLowerCase('de') || ''))
    .slice(0, 5);
  const noteOptions = (notes || [])
    .filter(
      (n) =>
        n.scope === scope &&
        !n.deleted &&
        n.id !== note?.id &&
        titleOf(n.content)
          .toLocaleLowerCase('de')
          .includes(tagToken?.query.toLocaleLowerCase('de') || ''),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const suggestions =
    tagToken?.kind === 'note'
      ? noteOptions.map((n) => ({ id: n.id, label: titleOf(n.content) }))
      : tagOptions.map((t) => ({ id: t, label: '#' + t }));
  const inspectTag = (el: HTMLTextAreaElement) => {
    const end = el.selectionStart;
    const before = el.value.slice(0, end);
    const reference = before.match(/\[\[([^\]\n]*)$/);
    const match = before.match(/(?:^|\s)#([\p{L}\p{N}_/-]*)$/u);
    setTagToken(
      el.selectionStart !== el.selectionEnd
        ? null
        : reference
          ? { start: end - reference[1].length - 2, end, query: reference[1], kind: 'note' }
          : match
            ? { start: end - match[1].length - 1, end, query: match[1], kind: 'tag' }
            : null,
    );
    setTagIndex(0);
  };
  const acceptSuggestion = (id: string) => {
    if (!tagToken) return;
    const target = tagToken.kind === 'note' ? noteOptions.find((n) => n.id === id) : undefined;
    if (tagToken.kind === 'note' && !target) return;
    const tail = content
      .slice(tagToken.end)
      .replace(tagToken.kind === 'note' ? /^\]\]/ : /^[\p{L}\p{N}_/-]*/u, '');
    const next = content.slice(0, tagToken.start) + (target ? noteLink(target) : '#' + id) + ' ';
    acceptedTagCaret.current = { start: next.length, end: next.length };
    change(next + tail);
    setTagToken(null);
  };
  const format = (kind: Format) => {
    const el = input.current;
    if (!el) return;
    const result = formatText(content, el.selectionStart, el.selectionEnd, kind);
    acceptedTagCaret.current = { start: result.start, end: result.end };
    change(result.text);
    setTagToken(null);
  };
  const insertReference = () => {
    const start = input.current?.selectionStart ?? content.length;
    const end = input.current?.selectionEnd ?? start;
    acceptedTagCaret.current = { start: start + 2, end: start + 2 };
    change(content.slice(0, start) + '[[' + content.slice(end));
    setTagToken({ start, end: start + 2, query: '', kind: 'note' });
    setTagIndex(0);
  };
  const updateCollections = (names: string[]) => {
    const next = normalizeCollections(names);
    collectionRef.current = next;
    setCollections(next);
    change(textRef.current);
  };
  const addCollection = (value: string) => {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const existing = knownCollections.find((c) => c.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    updateCollections([...collections, existing || name]);
    void createCollection(scope, existing || name).catch((error) => notify(String(error)));
    setCollectionInput('');
  };
  useEffect(() => {
    if (!compact) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const focus = () => {
      setPreview(false);
      clearTimeout(timer);
      timer = setTimeout(() => input.current?.focus(), 100);
    };
    window.addEventListener('noto-focus-capture', focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('noto-focus-capture', focus);
    };
  }, [compact]);
  const file = useRef<HTMLInputElement>(null);
  const base = useRef(note?.revision ?? null);
  const queue = useRef(Promise.resolve());
  const alive = useRef(true);
  const textRef = useRef(content);
  const initial = useRef(note?.content ?? '');
  const draftId = note?.id ?? draftSource ?? (compact ? 'widget' : null);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setReady(false);
    base.current = note?.revision ?? null;
    initial.current = note?.content ?? '';
    repo
      .draft(scope, draftId)
      .then((d) => {
        if (cancelled) return;
        const restored = d?.content ?? note?.content ?? '';
        setContent(restored);
        const restoredCollections = d?.collections || note?.collections || initialCollections;
        setCollections(restoredCollections);
        collectionRef.current = restoredCollections;
        initialCollectionRef.current = note?.collections || initialCollections;
        textRef.current = restored;
        if (d) {
          setPreview(false);
          base.current = d.baseRevision;
          setDraftStatus('Entwurf wiederhergestellt');
        }
        setReady(true);
        setTimeout(() => input.current?.focus(), 80);
      })
      .catch((e) => {
        setError(String(e));
        setReady(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(statusTimer.current);
    };
    // The editor must not replace unsaved text when the shared store refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, draftId]);
  const change = useCallback(
    (value: string) => {
      setContent(value);
      const generation = ++editGeneration.current;
      textRef.current = value;
      setDraftStatus('Entwurf wird gesichert …');
      clearTimeout(statusTimer.current);
      const draft = {
        key: `${scope}:${draftId ?? 'new'}`,
        scope,
        noteId: draftId,
        content: value,
        collections: collectionRef.current,
        baseRevision: base.current,
        updatedAt: new Date().toISOString(),
      };
      queue.current = queue.current
        .catch(() => {})
        .then(() => repo.saveDraft(draft))
        .then(() => {
          if (alive.current && editGeneration.current === generation) {
            statusTimer.current = setTimeout(() => {
              if (alive.current && editGeneration.current === generation) setDraftStatus('Entwurf gesichert');
            }, 650);
          }
        })
        .catch((e) => {
          if (alive.current) setError(`Entwurf konnte nicht gesichert werden: ${String(e)}`);
        });
    },
    [scope, draftId],
  );
  const observedRevision = useRef(note?.revision);
  useEffect(() => {
    const previous = observedRevision.current;
    observedRevision.current = note?.revision;
    // A drop changes metadata only. Merge it without discarding an open text draft.
    if (!note || previous === note.revision || base.current !== previous || note.content !== initial.current)
      return;
    const before = initialCollectionRef.current;
    const local = collectionRef.current;
    const removed = before.filter((name) => !local.includes(name));
    const added = local.filter((name) => !before.includes(name));
    const merged = normalizeCollections([
      ...(note.collections || []).filter((name) => !removed.includes(name)),
      ...added,
    ]);
    base.current = note.revision;
    initialCollectionRef.current = note.collections || [];
    collectionRef.current = merged;
    setCollections(merged);
    if (
      textRef.current !== initial.current ||
      JSON.stringify(merged) !== JSON.stringify(note.collections || [])
    )
      change(textRef.current);
  }, [note?.revision, change]);
  async function save(asCopy = false) {
    if (saving || imageOperations.current > 0 || !ready || !content.trim()) return;
    setSaving(true);
    setError('');
    try {
      await queue.current;
      let saved: Note;
      if (note && !asCopy) {
        const current = await repo.get(scope, note.id);
        if (!current || current.revision !== base.current)
          throw new Error(
            'Es gibt eine neuere Fassung. Dein Text ist als Entwurf gesichert. Speichere ihn als neue Notiz, um beide zu behalten.',
          );
        saved = reviseNote(current, { content, collections });
        await repo.put(saved, current.revision);
      } else {
        saved = { ...newNote(scope, content), collections };
        await repo.put(saved, null);
      }
      await repo.removeDraft(scope, draftId);
      base.current = saved.revision;
      initial.current = content;
      initialCollectionRef.current = collections;
      setDraftStatus('Gespeichert');
      ++editGeneration.current;
      clearTimeout(statusTimer.current);
      notify('Notiz gespeichert');
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  async function addFiles(files: File[]) {
    if (!files.length) return;
    imageOperations.current++;
    setAddingImages(imageOperations.current);
    setError('');
    try {
      const markdown = [];
      for (const f of files)
        markdown.push(
          await (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
            ? repo.addPdf(scope, f)
            : repo.addImage(scope, f)),
        );
      const el = input.current;
      const position = el?.selectionStart ?? textRef.current.length;
      const current = textRef.current;
      const insert = '\n\n' + markdown.join('\n\n') + '\n';
      change(current.slice(0, position) + insert + current.slice(position));
      setPreview(false);
      setTimeout(() => input.current?.focus(), 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      imageOperations.current--;
      if (alive.current) setAddingImages(imageOperations.current);
    }
  }
  async function rewrite() {
    if (rewriting || saving || !ready || !content.trim()) return;
    const before = textRef.current,
      generation = editGeneration.current;
    setRewriting(true);
    setError('');
    try {
      const after = await rewriteNote(scope, before, note);
      if (!alive.current) return;
      if (editGeneration.current !== generation || textRef.current !== before)
        throw new Error('Der Text wurde inzwischen geändert. Bitte die Überarbeitung erneut starten.');
      change(after);
      setRewriteUndo({ before, after });
      setPreview(false);
      notify('Überarbeitet – als Entwurf. Bitte vor dem Speichern prüfen.');
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setRewriting(false);
    }
  }
  const dirty =
    content !== initial.current ||
    JSON.stringify(collections) !== JSON.stringify(initialCollectionRef.current);
  const outgoing = linkedNotes(content, notes || [], scope);
  const incoming = note ? backlinks(note, notes || []) : [];
  return (
    <section
      className={`editor ${compact ? 'editor-compact' : ''} ${preview ? 'editor-reading' : ''} ${note && !compact ? 'editor-with-annotations' : ''}`}
      aria-label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
    >
      <div className="editor-heading">
        <div className="editor-top">
          {onBack && !compact && (
            <button
              type="button"
              className="mobile-back icon-button"
              aria-label="Zur Notizliste"
              onClick={onBack}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="toolbar">
            {!compact && (
              <Action
                label={rewriting ? 'Wird überarbeitet …' : 'Mit KI überarbeiten'}
                icon={<WandSparkles size={17} />}
                isIconOnly
                variant="ghost"
                isDisabled={rewriting || saving || !ready || !content.trim()}
                onClick={() => void rewrite()}
              />
            )}
            {rewriteUndo && content === rewriteUndo.after && (
              <Action
                label="KI-Überarbeitung rückgängig"
                icon={<Undo2 size={17} />}
                isIconOnly
                variant="ghost"
                isDisabled={saving || rewriting}
                onClick={() => {
                  change(rewriteUndo.before);
                  setRewriteUndo(null);
                  setPreview(false);
                }}
              />
            )}
            <Action
              label={preview ? 'Bearbeiten' : 'Vorschau'}
              icon={preview ? <PenLine size={17} /> : <Eye size={17} />}
              isIconOnly
              variant="ghost"
              onClick={() => setPreview(!preview)}
            />
            {note && !compact && (
              <Action
                label="Versionshistorie"
                icon={<History size={17} />}
                isIconOnly
                variant="ghost"
                onClick={() => setHistory(true)}
              />
            )}
            {onClose && (
              <Action
                label="Schließen, Entwurf behalten"
                icon={<X size={17} />}
                isIconOnly
                variant="ghost"
                onClick={onClose}
              />
            )}
          </div>
        </div>
        {note && !compact && (
          <div className="note-meta">
            Erstellt {readableDate(note.createdAt)} · {note.history.length}{' '}
            {note.history.length === 1 ? 'Textversion' : 'Textversionen'}
            {note.conflictOf && <span className="conflict-label">Konfliktkopie</span>}
          </div>
        )}
      </div>
      {note && !compact && <NoteAnnotations key={note.id} note={note} hasUnsavedChanges={dirty} />}
      <div className="editor-body">
        {!preview && (
          <div className="formatting-toolbar" role="toolbar" aria-label="Text formatieren">
            {(
              [
                ['bold', 'Fett (Strg B)', Bold],
                ['italic', 'Kursiv (Strg I)', Italic],
                ['heading', 'Überschrift', Heading2],
                ['bullet', 'Aufzählung', List],
                ['number', 'Nummerierte Liste', ListOrdered],
                ['task', 'Checkbox', ListTodo],
                ['quote', 'Zitat', Quote],
                ['link', 'Weblink einfügen', Link],
              ] as const
            ).map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                aria-label={label}
                title={label}
                disabled={!ready || saving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(kind)}
              >
                <Icon size={17} />
              </button>
            ))}
            <span className="toolbar-separator" />
            <button
              type="button"
              aria-label="Notiz verlinken"
              title="Notiz verlinken ([[)"
              disabled={!ready || saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertReference}
            >
              <FileSymlink size={17} />
            </button>
          </div>
        )}
        <div
          className={`editor-content ${preview ? 'is-preview' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          {preview ? (
            <NoteMarkdown content={content || '*Noch kein Text.*'} scope={scope} />
          ) : (
            <textarea
              ref={input}
              aria-label="Notiztext"
              value={content}
              disabled={!ready || saving}
              placeholder={
                compact
                  ? 'Ein Gedanke, eine Idee, etwas für später …\n\n#thema'
                  : 'Ein Gedanke, eine Idee, etwas für später …\n\nMit #Hashtags behältst du den Überblick.'
              }
              onChange={(e) => {
                change(e.target.value);
                inspectTag(e.target);
              }}
              onClick={(e) => inspectTag(e.currentTarget)}
              onBlur={() => setTagToken(null)}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) inspectTag(e.currentTarget);
              }}
              aria-controls={tagToken && suggestions.length ? 'tag-suggestions' : undefined}
              aria-activedescendant={tagToken && suggestions.length ? `tag-option-${tagIndex}` : undefined}
              onPaste={(e) => {
                const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
                if (images.length) {
                  e.preventDefault();
                  void addFiles(images);
                }
              }}
              onKeyDown={(e) => {
                if (
                  !e.nativeEvent.isComposing &&
                  (e.ctrlKey || e.metaKey) &&
                  !e.altKey &&
                  ['b', 'i'].includes(e.key.toLowerCase())
                ) {
                  e.preventDefault();
                  format(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
                  return;
                }
                if (tagToken && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setTagToken(null);
                    return;
                  }
                  if (suggestions.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
                    e.preventDefault();
                    if (e.key === 'Enter') acceptSuggestion((suggestions[tagIndex] || suggestions[0]).id);
                    else
                      setTagIndex(
                        (i) =>
                          (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length,
                      );
                    return;
                  }
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
              }}
              spellCheck
              lang="de"
            />
          )}
          {!preview &&
            tagToken &&
            tagPosition &&
            (suggestions.length > 0 || tagToken.kind === 'note') &&
            createPortal(
              <div
                className="tag-suggestions"
                style={tagPosition}
                id="tag-suggestions"
                role="listbox"
                aria-label={tagToken.kind === 'note' ? 'Notiz auswählen' : 'Vorhandene Tags'}
              >
                {suggestions.map((suggestion, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === tagIndex}
                    id={`tag-option-${i}`}
                    key={suggestion.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => acceptSuggestion(suggestion.id)}
                  >
                    {suggestion.label}
                  </button>
                ))}
                {!suggestions.length && <p className="suggestions-empty">Keine passende Notiz</p>}
              </div>,
              document.body,
            )}
        </div>
        {!preview && attachmentIds(content).some((id) => id.endsWith('.pdf')) && (
          <div className="editor-attachments" aria-label="PDF-Anhänge">
            {attachmentIds(content)
              .filter((id) => id.endsWith('.pdf'))
              .map((id) => {
                return (
                  <PdfAttachment key={id} scope={scope} id={id}>
                    <AttachmentTitle content={content} scope={scope} id={id} />
                  </PdfAttachment>
                );
              })}
          </div>
        )}
        {tagsOf(content).length > 0 && (
          <div className="editor-tags">
            {tagsOf(content).map((tag) => (
              <span className="tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
        )}
        {!compact && (
          <div className="note-collections">
            <button
              type="button"
              className="text-button"
              aria-expanded={collectionsOpen}
              onClick={() => setCollectionsOpen(!collectionsOpen)}
            >
              <FolderOpen size={15} /> Sammlungen{collections.length ? ` · ${collections.length}` : ''}
            </button>
            {collections.map((name) => (
              <span className="collection-chip" key={name}>
                {name}
                <button
                  type="button"
                  aria-label={`${name} aus dieser Notiz entfernen`}
                  disabled={!ready || saving}
                  onClick={() => updateCollections(collections.filter((c) => c !== name))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {collectionsOpen && (
              <div className="collection-picker">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addCollection(collectionInput);
                  }}
                >
                  <input
                    aria-label="Sammlung"
                    placeholder="Sammlung suchen oder anlegen …"
                    maxLength={60}
                    value={collectionInput}
                    onChange={(e) => setCollectionInput(e.target.value)}
                    disabled={!ready || saving}
                  />
                  <button
                    type="submit"
                    disabled={!ready || saving || !collectionInput.trim() || collections.length >= 30}
                  >
                    Hinzufügen
                  </button>
                </form>
                {knownCollections
                  .filter(
                    (c) =>
                      !collections.includes(c) &&
                      c.toLocaleLowerCase('de').includes(collectionInput.toLocaleLowerCase('de')),
                  )
                  .sort((a, b) => a.localeCompare(b, 'de'))
                  .slice(0, 8)
                  .map((c) => (
                    <button
                      className="collection-choice"
                      type="button"
                      key={c}
                      disabled={!ready || saving || collections.length >= 30}
                      onClick={() => addCollection(c)}
                    >
                      <FolderOpen size={14} />
                      {c}
                    </button>
                  ))}
                <small>
                  Eine Notiz kann in mehreren Sammlungen liegen. Änderungen werden mit der Notiz gespeichert.
                </small>
              </div>
            )}
          </div>
        )}
        {(outgoing.length > 0 || incoming.length > 0) && (
          <div className="note-connections">
            {outgoing.length > 0 && (
              <details>
                <summary>Verlinkt · {outgoing.length}</summary>
                <ul>
                  {outgoing.map((n) => (
                    <li key={n.id}>
                      <NoteReferenceLink id={n.id} scope={scope} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {incoming.length > 0 && (
              <details>
                <summary>Erwähnt in · {incoming.length}</summary>
                <ul>
                  {incoming.map((n) => (
                    <li key={n.id}>
                      <NoteReferenceLink id={n.id} scope={scope} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
            {note && (
              <button className="text-button" onClick={() => void save(true)}>
                Als neue Notiz sichern
              </button>
            )}
          </div>
        )}
        <div className="editor-footer">
          <div className="editor-tools">
            <Dictation
              scope={scope}
              onInsert={(text) => {
                const position = input.current?.selectionStart ?? textRef.current.length;
                change(textRef.current.slice(0, position) + text + textRef.current.slice(position));
              }}
            />
            <Action
              label="Bild oder PDF hinzufügen"
              icon={<ImagePlus size={18} />}
              isIconOnly
              variant="ghost"
              onClick={() => file.current?.click()}
            />
            <input
              ref={file}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf,.pdf"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <span
              className={`draft-state save-indicator ${error ? 'save-error' : addingImages || draftStatus.includes('wird') ? 'save-writing' : draftStatus ? 'save-saved' : ''}`}
              role="status"
              aria-label={
                error
                  ? 'Speicherfehler'
                  : addingImages
                    ? 'Anhang wird gespeichert'
                    : draftStatus || 'Noch kein Entwurf'
              }
              title={error || draftStatus || 'Noch kein Entwurf'}
            >
              <Save size={17} />
            </span>
          </div>
          <Action
            label={note && !dirty ? 'Gespeichert' : 'Festhalten'}
            variant="primary"
            icon={note && !dirty ? <Check size={16} /> : <Save size={16} />}
            isDisabled={!ready || addingImages > 0 || !content.trim() || Boolean(note && !dirty)}
            isLoading={saving}
            onClick={() => void save()}
          />
        </div>
        {!compact && (
          <div className="editor-hint">
            <span>Bilder und PDFs hereinziehen</span>
            <span className="save-shortcut-hint">Strg + Enter zum Speichern</span>
          </div>
        )}
        {history && note && (
          <Modal
            title="Versionshistorie"
            onClose={() => {
              setHistory(false);
              setOldRevision(null);
            }}
            width={720}
          >
            <p className="muted">
              Eine Wiederherstellung wird als neue Version gespeichert. Frühere Fassungen bleiben erhalten.
            </p>
            <div className="history-layout">
              <div className="history-list">
                {[...note.history].reverse().map((r, i) => (
                  <button
                    key={r.revision}
                    className={`history-item ${oldRevision?.revision === r.revision ? 'selected' : ''}`}
                    onClick={() => setOldRevision(r)}
                  >
                    {readableDate(r.savedAt)}
                    <span>{i === 0 ? 'Aktuelle Textversion' : `Version ${note.history.length - i}`}</span>
                  </button>
                ))}
              </div>
              <div className="history-preview">
                <NoteMarkdown
                  content={(oldRevision ?? note.history[note.history.length - 1]).content}
                  scope={scope}
                />
              </div>
            </div>
            <div className="modal-actions">
              <Action label="Schließen" onClick={() => setHistory(false)} />
              <Action
                label="Als Entwurf übernehmen"
                variant="primary"
                isDisabled={!oldRevision}
                onClick={() => {
                  if (oldRevision) {
                    change(oldRevision.content);
                    setHistory(false);
                    setPreview(false);
                  }
                }}
              />
            </div>
          </Modal>
        )}
      </div>
    </section>
  );
}
