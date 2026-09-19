import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, History, ImagePlus, PenLine, Save, X } from 'lucide-react';
import { Action, Modal, NoteMarkdown, readableDate } from './components';
import { newNote, reviseNote, tagsOf, type Note, type Revision } from './domain';
import { repo } from './repository';
import { useNotto } from './state';
import { Dictation } from './Dictation';

export function Editor({
  note,
  compact = false,
  onSaved,
  onClose,
}: {
  note?: Note;
  compact?: boolean;
  onSaved: (note: Note) => void;
  onClose?: () => void;
}) {
  const { scope, notify } = useNotto();
  const [content, setContent] = useState(note?.content ?? '');
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
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
  const draftId = note?.id ?? (compact ? 'widget' : null);
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
        textRef.current = restored;
        if (d) {
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
        saved = reviseNote(current, { content });
        await repo.put(saved, current.revision);
      } else {
        saved = newNote(scope, content);
        await repo.put(saved, null);
      }
      await repo.removeDraft(scope, draftId);
      base.current = saved.revision;
      initial.current = content;
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
  const dirty = content !== initial.current;
  return (
    <section
      className={`editor ${compact ? 'editor-compact' : ''}`}
      aria-label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
    >
      <div className="editor-top">
        <div>
          <span className="eyebrow">{note ? 'ORIGINALNOTIZ' : 'NEUE NOTIZ'}</span>
          {!compact && <h1>{note ? 'Dein Gedanke.' : 'Was möchtest du festhalten?'}</h1>}
        </div>
        <div className="toolbar">
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
            onChange={(e) => change(e.target.value)}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
              if (images.length) {
                e.preventDefault();
                void addFiles(images);
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void save();
              }
            }}
            spellCheck
            lang="de"
          />
        )}
      </div>
      {tagsOf(content).length > 0 && (
        <div className="editor-tags">
          {tagsOf(content).map((tag) => (
            <span className="tag" key={tag}>
              #{tag}
            </span>
          ))}
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
          <span>Strg + Enter zum Speichern</span>
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
    </section>
  );
}
