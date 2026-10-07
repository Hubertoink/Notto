import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, FileText, RefreshCw } from 'lucide-react';
import { serverRequest } from './backend';
import { ownBackend, readCloudConfig } from './cloud';
import { useNotto } from './state';
import type { DocumentAvailability } from './document-availability';
export function SourceImport({
  source,
  from,
}: {
  source: { title: string; url: string };
  from: { noteId: string; scope: string };
}) {
  if (from.scope === 'local' || !ownBackend()) return null;
  return (
    <SourceImportControl key={`${from.scope}:${from.noteId}:${source.url}`} source={source} from={from} />
  );
}
function SourceImportControl({
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
  const [availability, setAvailability] = useState<DocumentAvailability>();
  const [checking, setChecking] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const checkingLock = useRef(false);
  const alive = useRef(true);
  const check = useCallback(
    async (refresh = false) => {
      if (checkingLock.current) return;
      checkingLock.current = true;
      setChecking(true);
      setError('');
      try {
        const result = await serverRequest(readCloudConfig().url, '/documents/check', {
          noteId: from.noteId,
          url: source.url,
          ...(refresh ? { refresh: true } : {}),
        });
        if (alive.current) setAvailability(result.availability);
      } catch {
        if (alive.current)
          setAvailability({
            status: 'unknown',
            message: 'PDF-Verfügbarkeit derzeit nicht prüfbar. Bitte später erneut prüfen.',
          });
      } finally {
        checkingLock.current = false;
        if (alive.current) setChecking(false);
      }
    },
    [from.noteId, source.url],
  );
  useEffect(() => {
    alive.current = true;
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              void check();
            }
          });
    if (observer && element.current) observer.observe(element.current);
    else void check();
    return () => {
      alive.current = false;
      observer?.disconnect();
    };
  }, [check]);
  const lock = useRef(false);
  return (
    <div className="source-import" ref={element}>
      {!documentId && availability && availability.status !== 'available' ? (
        <div className="source-availability">
          <span className="small muted" title={availability.message}>
            {availability.status === 'unavailable'
              ? 'Kein frei zugängliches PDF'
              : 'PDF-Verfügbarkeit derzeit nicht prüfbar'}
          </span>
          <button
            type="button"
            className="icon-button"
            title="Quelle erneut prüfen"
            aria-label="Quelle erneut prüfen"
            disabled={checking}
            onClick={() => void check(true)}
          >
            {checking ? <LoaderCircle size={14} className="command-spin" /> : <RefreshCw size={14} />}
          </button>
          <span className="small muted">
            {availability.status === 'unavailable'
              ? 'Die Quelle bleibt als Weblink nutzbar.'
              : 'Du kannst die Prüfung später wiederholen.'}
          </span>
        </div>
      ) : (
        <button
          className="text-button small"
          type="button"
          disabled={busy || (!documentId && (checking || availability?.status !== 'available'))}
          onClick={() => {
            if (documentId) {
              window.dispatchEvent(
                new CustomEvent('notto-open-note', { detail: { id: documentId, scope: from.scope } }),
              );
              return;
            }
            if (lock.current) return;
            if (availability?.status !== 'available') return;
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
                const status = String((e as { statusCode?: unknown })?.statusCode);
                if (['422', '424'].includes(status)) {
                  setAvailability({
                    status: status === '424' ? 'unknown' : 'unavailable',
                    message: e instanceof Error ? e.message : 'Die Quelle ist nicht als PDF verfügbar.',
                  });
                } else setError(e instanceof Error ? e.message : 'Import fehlgeschlagen.');
              } finally {
                lock.current = false;
                setBusy(false);
              }
            })();
          }}
        >
          {busy || checking ? (
            <LoaderCircle size={14} className="command-spin" />
          ) : documentId ? (
            <FileText size={14} />
          ) : (
            <Download size={14} />
          )}
          {busy
            ? 'Artikel wird importiert …'
            : documentId
              ? 'Dokument öffnen'
              : checking || !availability
                ? 'PDF wird geprüft …'
                : 'Als Dokument speichern'}
        </button>
      )}
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
