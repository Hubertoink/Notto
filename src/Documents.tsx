import { useEffect, useRef, useState } from 'react';
import { Action, readableDate } from './components';
import { PdfAttachment } from './PdfAttachment';
import { DocumentAttachment } from './DocumentAttachment';
import { attachmentIds, newNote, reviseNote, tagsOf, titleOf, type Note } from './domain';
import { createDocument, documentContent, documentPages, replaceDocument } from './document-store';
import { repo } from './repository';
import { fetchAttachment, ownBackend, syncNotes } from './cloud';
import { config, eligible, extract, knowledge, type Evidence } from './intelligence';
import { normalizeCollections } from './note-tools';
import { useNotto } from './state';
import { useKnowledgeRecords } from './Tasks';
import './documents.css';
import { ArrowLeft } from 'lucide-react';

export function DocumentUpload({
  collection,
  onOpen,
}: {
  collection?: string | null;
  onOpen: (id: string) => void;
}) {
  const { scope, notes, notify } = useNotto();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [drag, setDrag] = useState(false);
  async function upload(files: File[]) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        const attachment = await repo.addDocument(scope, file);
        const document = await createDocument(scope, attachment, collection ? [collection] : []);
        onOpen(document.id);
        try {
          await documentPages(document);
        } catch (e) {
          notify(`Datei gespeichert. ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const attached = notes
    .filter((note) => !note.document && !note.deleted && note.scope === scope)
    .flatMap((note) =>
      attachmentIds(note.content)
        .filter((id) => /\.(pdf|docx|txt|md)$/.test(id))
        .map((id) => ({ note, id })),
    )
    .filter(
      ({ id }, index, all) =>
        all.findIndex((item) => item.id === id) === index &&
        !notes.some((note) => !note.deleted && note.document?.attachmentId === id),
    );
  return (
    <div
      className={`document-upload ${drag ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDrag(false);
          void upload(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <Action
        label={busy ? 'Dokumente werden gelesen …' : 'Dokumente hochladen'}
        isDisabled={busy}
        onClick={() => input.current?.click()}
      />
      <p className="muted">PDF, DOCX, TXT und Markdown · bis 12 MB · auch per Drag-and-drop</p>
      {!!attached.length && (
        <details>
          <summary>Anhänge in Bibliothek übernehmen</summary>
          {attached.map(({ note, id }) => (
            <button
              key={id}
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void (async () => {
                  const attachment = await fetchAttachment(scope, id);
                  if (!attachment) throw new Error('Anhang fehlt. Bitte synchronisieren.');
                  const label = [...note.content.matchAll(/\[([^\]]+)\]\(attachments\/([^)]*)\)/g)].find(
                    (match) => match[2] === id,
                  )?.[1];
                  const document = await createDocument(
                    scope,
                    { ...attachment, name: label || attachment.name },
                    note.collections,
                    tagsOf(note.content),
                  );
                  onOpen(document.id);
                  await documentPages(document);
                })()
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {titleOf(note.content)} · {id.split('.').at(-1)?.toUpperCase()}
            </button>
          ))}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function CollectionQuestion({
  collection,
  onOpen,
}: {
  collection: string;
  onOpen: (id: string) => void;
}) {
  const { scope } = useNotto();
  const [question, setQuestion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="collection-question"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !question.trim()) return;
        setBusy(true);
        setError('');
        void (async () => {
          const note = {
            ...newNote(scope, `Frage zu ${collection}\n\n/ki ${question.trim().replace(/\r?\n/g, ' ')}`),
            collections: [collection],
            aiContext: { mode: 'collection' as const, collection, web: false },
          };
          await knowledge.sync(scope);
          await repo.put(note, null);
          onOpen(note.id);
          setQuestion('');
          await syncNotes(scope);
          await syncNotes(scope);
        })()
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <label>
        Frage zu dieser Sammlung
        <textarea
          rows={2}
          maxLength={4000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Was steht in unserer Konzeption zur Beteiligung Jugendlicher?"
        />
      </label>
      <Action
        label={busy ? 'Wird gestartet …' : 'KI fragen'}
        type="submit"
        isDisabled={busy || !question.trim() || scope === 'local' || !ownBackend() || !config(scope).enabled}
      />
      <p className="muted">Noto legt die Frage mit ihrer Antwort als Notiz in dieser Sammlung ab.</p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function DocumentDetail({
  note,
  onOpen,
  onBack,
}: {
  note: Note;
  onOpen: (id: string) => void;
  onBack?: () => void;
}) {
  const { sync, notify } = useNotto();
  const [title, setTitle] = useState(titleOf(note.content)),
    [tags, setTags] = useState(tagsOf(note.content).join(' '));
  const [collections, setCollections] = useState(note.collections?.join(', ') ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pages, setPages] = useState<Evidence[]>([]),
    [reading, setReading] = useState(true);
  const replacement = useRef<HTMLInputElement>(null);
  const records = useKnowledgeRecords(note.scope);
  const document = note.document!;
  useEffect(() => {
    setTitle(titleOf(note.content));
    setTags(tagsOf(note.content).join(' '));
    setCollections(note.collections?.join(', ') ?? '');
  }, [note.revision]);
  useEffect(() => {
    let alive = true;
    setReading(true);
    setError('');
    void documentPages(note)
      .then((result) => {
        if (alive) setPages(result);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setReading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    note.id,
    document.attachmentId,
    records
      .filter((record) => record.noteId === note.id && record.kind === 'extraction')
      .map((record) => record.id)
      .join(','),
  ]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await knowledge.sync(note.scope);
      await sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const readable = pages.filter((page) => page.text.trim() && !page.text.startsWith('[Kein Text erkannt.'));
  const missing = pages.length - readable.length;
  const older = note.history
    .flatMap((revision) =>
      attachmentIds(revision.content).map((id) => ({ id, at: revision.savedAt, content: revision.content })),
    )
    .filter(
      (item, index, all) =>
        item.id !== document.attachmentId && all.findIndex((other) => other.id === item.id) === index,
    );
  return (
    <section className="document-panel" aria-label="Dokument bearbeiten">
      {onBack && (
        <button
          type="button"
          className="mobile-back icon-button"
          aria-label="Zur Dokumentliste"
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <h1>{titleOf(note.content)}</h1>
      <p className="muted">
        {document.name} · Version {document.version}
      </p>
      <p className="document-status" role="status">
        {!eligible(note)
          ? 'Von der KI ausgeschlossen'
          : reading
            ? 'Dokument wird gelesen …'
            : !readable.length
              ? 'Kein lesbarer Text · Texterkennung erforderlich'
              : missing
                ? `${readable.length} Seiten lesbar · ${missing} Seiten benötigen Texterkennung`
                : 'Für KI verfügbar'}
        {!config(note.scope).enabled && ' · KI derzeit ausgeschaltet'}
      </p>
      <div className="document-actions">
        {document.attachmentId.endsWith('.pdf') ? (
          <PdfAttachment scope={note.scope} id={document.attachmentId}>
            {document.name} öffnen
          </PdfAttachment>
        ) : (
          <DocumentAttachment scope={note.scope} id={document.attachmentId} name={document.name}>
            {document.name} öffnen
          </DocumentAttachment>
        )}
        <Action
          label="Neue Fassung hochladen"
          isDisabled={busy}
          onClick={() => replacement.current?.click()}
        />
        <input
          ref={replacement}
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              void run(async () => {
                const updated = await replaceDocument(note, file);
                await documentPages(updated);
                notify('Neue Dokumentfassung gespeichert');
              });
          }}
        />
        {document.attachmentId.endsWith('.pdf') && missing > 0 && (
          <Action
            label="Texterkennung starten"
            isDisabled={busy || !config(note.scope).enabled || !eligible(note)}
            onClick={() =>
              void run(async () => {
                await extract(note, document.attachmentId, true);
                await knowledge.sync(note.scope);
              })
            }
          />
        )}
      </div>
      <form
        className="document-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const parsedTags = tagsOf(
              tags
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
                .join(' '),
            );
            const updated = reviseNote(note, {
              content: documentContent(title, parsedTags, { id: document.attachmentId, name: document.name }),
              collections: normalizeCollections(collections.split(',')),
            });
            await repo.put(updated, note.revision);
            notify('Dokument aktualisiert');
          });
        }}
      >
        <label>
          Titel
          <input value={title} maxLength={110} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="jugendhaus konzeption pädagogik"
          />
        </label>
        <label>
          Sammlungen
          <input
            value={collections}
            onChange={(e) => setCollections(e.target.value)}
            placeholder="Jugendhaus, Organisation"
          />
        </label>
        <Action label="Änderungen speichern" type="submit" isDisabled={busy || !title.trim()} />
      </form>
      <Action
        label="Mit diesem Dokument arbeiten"
        isDisabled={busy || !eligible(note)}
        onClick={() =>
          void run(async () => {
            const draft = {
              ...newNote(note.scope, `Gedanken zu ${titleOf(note.content)}\n\n`),
              collections: note.collections,
              aiContext: { mode: 'selected' as const, sourceIds: [note.id], web: false },
            };
            await repo.put(draft, null);
            onOpen(draft.id);
          })
        }
      />
      {older.length > 0 && (
        <details>
          <summary>Frühere Dokumentfassungen ({older.length})</summary>
          {older.map((item) => (
            <p key={item.id}>
              {readableDate(item.at)} ·{' '}
              {item.id.endsWith('.pdf') ? (
                <PdfAttachment scope={note.scope} id={item.id}>
                  PDF öffnen
                </PdfAttachment>
              ) : (
                <DocumentAttachment scope={note.scope} id={item.id}>
                  Dokument öffnen
                </DocumentAttachment>
              )}
            </p>
          ))}
          <p className="muted">Die KI verwendet die aktuelle Fassung.</p>
        </details>
      )}
      {error && (
        <p role="alert" className="command-error">
          {error}
        </p>
      )}
      {!!readable.length && (
        <details>
          <summary>Erkannten Text prüfen</summary>
          <pre className="document-text">
            {readable.map((page) => `${page.page ? `Seite ${page.page}\n` : ''}${page.text}`).join('\n\n')}
          </pre>
        </details>
      )}
    </section>
  );
}
