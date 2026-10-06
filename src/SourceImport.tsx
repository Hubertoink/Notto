import { useRef, useState } from 'react';
import { Download, LoaderCircle, FileText } from 'lucide-react';
import { serverRequest } from './backend';
import { ownBackend, readCloudConfig } from './cloud';
import { useNotto } from './state';
export function SourceImport({
  source,
  from,
}: {
  source: { title: string; url: string };
  from: { noteId: string; scope: string };
}) {
  const { sync, notify } = useNotto();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [documentId, setDocumentId] = useState('');
  const lock = useRef(false);
  if (from.scope === 'local' || !ownBackend()) return null;
  return (
    <div className="source-import">
      <button
        className="text-button small"
        type="button"
        disabled={busy}
        onClick={() => {
          if (documentId) {
            window.dispatchEvent(
              new CustomEvent('notto-open-note', { detail: { id: documentId, scope: from.scope } }),
            );
            return;
          }
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const result = await serverRequest(readCloudConfig().url, '/documents/import', {
                noteId: from.noteId,
                url: source.url,
                title: source.title,
              });
              setDocumentId(result.document.noteId);
              await sync();
              notify(
                result.document.reused
                  ? 'Vorhandenes Dokument mit dieser Notiz verknüpft.'
                  : result.document.needsOCR
                    ? 'PDF gespeichert und verknüpft. Für unlesbare Seiten kannst du Texterkennung starten.'
                    : 'Artikel gespeichert, Text eingelesen und mit dieser Notiz verknüpft.',
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Import fehlgeschlagen.');
            } finally {
              lock.current = false;
              setBusy(false);
            }
          })();
        }}
      >
        {busy ? (
          <LoaderCircle size={14} className="command-spin" />
        ) : documentId ? (
          <FileText size={14} />
        ) : (
          <Download size={14} />
        )}
        {busy ? 'Artikel wird importiert …' : documentId ? 'Dokument öffnen' : 'Als Dokument speichern'}
      </button>
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
