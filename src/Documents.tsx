import { useEffect, useRef, useState } from 'react';
import { Action, readableDate, WebLink } from './components';
import { PdfAttachment } from './PdfAttachment';
import { DocumentAttachment } from './DocumentAttachment';
import { AttachmentDownload } from './AttachmentDownload';
import { attachmentIds, newNote, tagsOf, titleOf, type Note } from './domain';
import { createDocument, documentPages, replaceDocument } from './document-store';
import { repo } from './repository';
import { fetchAttachment, ownBackend, syncNotes } from './cloud';
import { config, eligible, extract, knowledge, type Evidence } from './intelligence';
import { collectionNames } from './collections';
import { DocumentLabels } from './DocumentLabels';
import {
  mergeDocumentMetadataChanges,
  updateDocumentMetadata,
  type DocumentMetadataChange,
} from './document-metadata';
import { useNotto } from './state';
import { useKnowledgeRecords } from './Tasks';
import './documents.css';
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Clock3,
  FileText,
  ShieldOff,
  Upload,
} from 'lucide-react';

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
            aiContext: { mode: 'collection' as const, collection },
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
  const { sync, notify, notes } = useNotto();
  const [title, setTitle] = useState(titleOf(note.content)),
    [tags, setTags] = useState(tagsOf(note.content));
  const [collections, setCollections] = useState(note.collections ?? []);
  const [tagInput, setTagInput] = useState(''),
    [collectionInput, setCollectionInput] = useState('');
  const [ocrProgress, setOcrProgress] = useState('');
  const [metadataStatus, setMetadataStatus] = useState('');
  const metadataQueue = useRef(Promise.resolve());
  const pendingMetadata = useRef(0);
  const failedMetadata = useRef<DocumentMetadataChange[]>([]);
  const titleDirty = useRef(false);
  const titleRef = useRef(title);
  titleRef.current = title;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pages, setPages] = useState<Evidence[]>([]),
    [reading, setReading] = useState(true);
  const replacement = useRef<HTMLInputElement>(null);
  const records = useKnowledgeRecords(note.scope);
  const document = note.document!;
  useEffect(() => {
    if (pendingMetadata.current || failedMetadata.current.length) return;
    if (!titleDirty.current) setTitle(titleOf(note.content));
    setTags(tagsOf(note.content));
    setCollections(note.collections ?? []);
    setOcrProgress('');
  }, [note.id, note.revision]);
  function saveMetadata(change: DocumentMetadataChange) {
    if ('title' in change)
      failedMetadata.current = failedMetadata.current.filter((previous) => !('title' in previous));
    pendingMetadata.current++;
    setMetadataStatus('Wird gespeichert …');
    setError('');
    const owner = { id: note.id, scope: note.scope };
    metadataQueue.current = metadataQueue.current.then(async () => {
      if ('kind' in change) {
        const kind = change.kind;
        const previous = failedMetadata.current.filter((item) => 'kind' in item && item.kind === kind);
        failedMetadata.current = failedMetadata.current.filter(
          (item) => !('kind' in item) || item.kind !== kind,
        );
        change = mergeDocumentMetadataChanges([...previous, change]);
      }
      try {
        const saved = await updateDocumentMetadata(owner, change);
        if ('title' in change)
          failedMetadata.current = failedMetadata.current.filter((previous) => !('title' in previous));
        if ('title' in change && titleRef.current === change.title) titleDirty.current = false;
        if (alive.current && pendingMetadata.current === 1 && !failedMetadata.current.length && saved) {
          setTags(tagsOf(saved.content));
          setCollections(saved.collections ?? []);
          if (!titleDirty.current) setTitle(titleOf(saved.content));
        }
      } catch (e) {
        failedMetadata.current.push(change);
        if (alive.current)
          setError(e instanceof Error ? e.message : 'Änderung konnte nicht gespeichert werden.');
      } finally {
        pendingMetadata.current--;
        if (alive.current && !pendingMetadata.current) {
          setMetadataStatus(failedMetadata.current.length ? 'Nicht gespeichert' : 'Gespeichert');
          if (!failedMetadata.current.length)
            void knowledge
              .sync(owner.scope)
              .then(() => {
                if (alive.current) return sync();
              })
              .catch((e) => {
                if (alive.current) setError(String(e));
              });
        }
      }
    });
  }
  function saveTitle() {
    if (titleDirty.current) saveMetadata({ title: titleRef.current });
  }
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
      await metadataQueue.current;
      if (failedMetadata.current.length)
        throw new Error('Bitte zuerst die nicht gespeicherte Änderung korrigieren oder erneut speichern.');
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      try {
        await knowledge.sync(note.scope);
        await sync();
      } catch (e) {
        setError((previous) =>
          [previous, e instanceof Error ? e.message : String(e)].filter(Boolean).join(' · '),
        );
      }
      setBusy(false);
      setOcrProgress('');
    }
  }
  const readable = pages.filter((page) => page.text.trim() && !page.text.startsWith('[Kein Text erkannt.'));
  const missing = pages.length - readable.length;
  const status = !eligible(note)
    ? 'excluded'
    : ocrProgress || reading
      ? 'reading'
      : !readable.length
        ? 'empty'
        : missing
          ? 'partial'
          : 'ready';
  const StatusIcon =
    status === 'ready'
      ? CircleCheck
      : status === 'excluded'
        ? ShieldOff
        : status === 'reading'
          ? Clock3
          : CircleAlert;
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
      {document.source && (
        <div className="document-origin muted small">
          <WebLink href={document.source.url}>Originalartikel</WebLink>
          {document.source.authors?.length ? <span> · {document.source.authors.join(', ')}</span> : null}
          {document.source.published ? <span> · {document.source.published}</span> : null}
          {document.source.doi ? <span> · DOI: {document.source.doi}</span> : null}
          {document.source.licenseUrl ? (
            <span>
              {' '}
              · <WebLink href={document.source.licenseUrl}>Lizenz</WebLink>
            </span>
          ) : null}
        </div>
      )}
      <div className="document-status" role="status">
        <span className={`document-status-badge document-status-${status}`}>
          <StatusIcon size={15} aria-hidden="true" />
          <span>
            {!eligible(note)
              ? 'Von der KI ausgeschlossen'
              : ocrProgress
                ? ocrProgress
                : reading
                  ? 'Dokument wird gelesen …'
                  : !readable.length
                    ? `Kein lesbarer Text${document.attachmentId.endsWith('.pdf') ? ' · Texterkennung erforderlich' : ''}`
                    : missing
                      ? `${readable.length} Seiten lesbar · ${missing} Seiten benötigen Texterkennung`
                      : 'Für KI verfügbar'}
          </span>
        </span>
        {!config(note.scope).enabled && (
          <span className="muted document-status-hint">KI derzeit ausgeschaltet</span>
        )}
      </div>
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
        <AttachmentDownload scope={note.scope} id={document.attachmentId} name={document.name} />
        <Action
          label="Neue Fassung hochladen"
          tooltip="Neue Fassung hochladen"
          icon={<Upload size={18} />}
          isIconOnly
          variant="ghost"
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
                const current = await repo.get(note.scope, note.id);
                if (!current || current.deleted) throw new Error('Das Dokument ist nicht mehr verfügbar.');
                const updated = await replaceDocument(current, file);
                await documentPages(updated);
                notify('Neue Dokumentfassung gespeichert');
              });
          }}
        />
        {document.attachmentId.endsWith('.pdf') && missing > 0 && (
          <Action
            label={
              ocrProgress
                ? 'Texterkennung läuft …'
                : records.some(
                      (record) =>
                        record.noteId === note.id &&
                        record.kind === 'extraction' &&
                        (record.data as { id?: string; ocr?: boolean }).id === document.attachmentId &&
                        (record.data as { ocr?: boolean }).ocr,
                    )
                  ? 'Texterkennung fortsetzen'
                  : 'Texterkennung starten'
            }
            isDisabled={busy || !config(note.scope).enabled || !eligible(note)}
            onClick={() =>
              void run(async () => {
                const result = await extract(note, document.attachmentId, true, {
                  onProgress: (progress) =>
                    setOcrProgress(
                      `Texterkennung · Seite ${progress.page} von ${progress.total} · ${progress.processed} in diesem Durchlauf erkannt`,
                    ),
                });
                notify(
                  result?.remaining
                    ? `${result.processed} Seiten erkannt · ${result.remaining} Seiten noch offen. Texterkennung fortsetzen.`
                    : 'Texterkennung abgeschlossen',
                );
              })
            }
          />
        )}
      </div>
      {document.attachmentId.endsWith('.pdf') && missing > 0 && (
        <p className="muted document-ocr-hint">
          Die Texterkennung liest bis zu fünf fehlende Seiten pro Durchlauf über OpenAI. Danach kannst du
          fortsetzen; erkannter Text bleibt gespeichert. Die Seiten werden dafür an OpenAI gesendet.{' '}
          Verwendetes Modell: <strong>{config(note.scope).model}</strong> (aus „Wissen & KI“).
        </p>
      )}
      <div className="document-form">
        <label>
          Titel
          <input
            value={title}
            maxLength={110}
            required
            disabled={busy}
            onChange={(e) => {
              titleDirty.current = true;
              titleRef.current = e.target.value;
              setTitle(e.target.value);
            }}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <DocumentLabels
          key={`${note.id}-tags`}
          kind="tags"
          values={tags}
          onChange={(values) => {
            setTags(values);
            saveMetadata({ kind: 'tags', before: tags, after: values });
          }}
          input={tagInput}
          onInput={setTagInput}
          disabled={busy}
          known={[
            ...new Set(
              notes
                .filter((item) => item.scope === note.scope && !item.deleted)
                .flatMap((item) => tagsOf(item.content)),
            ),
          ].sort((a, b) => a.localeCompare(b, 'de'))}
        />
        <DocumentLabels
          key={`${note.id}-collections`}
          kind="collections"
          values={collections}
          onChange={(values) => {
            setCollections(values);
            saveMetadata({ kind: 'collections', before: collections, after: values });
          }}
          input={collectionInput}
          onInput={setCollectionInput}
          disabled={busy}
          known={collectionNames(notes, records, note.scope)}
        />
        {metadataStatus && (
          <span className="muted small" role="status" aria-live="polite">
            {metadataStatus}
          </span>
        )}
        {metadataStatus === 'Nicht gespeichert' && (
          <Action
            label="Änderung erneut speichern"
            onClick={() => {
              const changes = failedMetadata.current.splice(0);
              changes.forEach(saveMetadata);
            }}
          />
        )}
      </div>
      <Action
        label="Mit diesem Dokument arbeiten"
        isDisabled={busy || !eligible(note)}
        onClick={() =>
          void run(async () => {
            const current = await repo.get(note.scope, note.id);
            if (!current || current.deleted) throw new Error('Das Dokument ist nicht mehr verfügbar.');
            const draft = {
              ...newNote(note.scope, `Gedanken zu ${titleOf(current.content)}\n\n`),
              collections: current.collections,
              aiContext: { mode: 'selected' as const, sourceIds: [note.id] },
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
        <details className="document-source">
          <summary>
            <FileText size={18} aria-hidden="true" />
            <span className="document-source-heading">
              <strong>Erkannten Text prüfen</strong>
              <small>
                {document.attachmentId.endsWith('.pdf')
                  ? `${readable.length} lesbare ${readable.length === 1 ? 'Seite' : 'Seiten'}`
                  : 'Dokumentinhalt'}{' '}
                · Quelle für die KI
              </small>
            </span>
            <ChevronRight size={18} className="document-source-chevron" aria-hidden="true" />
          </summary>
          <div className="document-source-body">
            <pre className="document-text">
              {readable.map((page) => `${page.page ? `Seite ${page.page}\n` : ''}${page.text}`).join('\n\n')}
            </pre>
          </div>
        </details>
      )}
    </section>
  );
}
