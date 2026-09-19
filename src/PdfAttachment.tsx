import { useEffect, useRef, useState, type ReactNode } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal } from './components';
import { fetchAttachment } from './cloud';
import { desktop } from './repository';
import type { Attachment } from './domain';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export function PdfAttachment({ scope, id, children }: { scope: string; id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false),
    [attachment, setAttachment] = useState<Attachment | null>(null),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let dispose: undefined | (() => Promise<void>);
    setError('');
    setPage(1);
    void (async () => {
      const a = await fetchAttachment(scope, id);
      if (!a) throw new Error('PDF fehlt. Bitte synchronisieren.');
      if (cancelled) return;
      setAttachment(a);
      const lib = await import('pdfjs-dist');
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href;
      const task = lib.getDocument({ data: new Uint8Array(a.bytes) });
      dispose = () => task.destroy();
      const document = await task.promise;
      if (!cancelled) setPdf(document);
      else await task.destroy();
    })().catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
      setPdf(null);
      void dispose?.();
    };
  }, [scope, id, open]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    void pdf
      .getPage(page)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const viewport = p.getViewport({ scale: 1.4 });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        task = p.render({ canvas: canvas.current, viewport });
        return task.promise;
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);
  async function download() {
    try {
      if (!attachment) return;
      if (desktop) {
        const path = await save({
          defaultPath: attachment.name,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (path) await invoke('write_export', { path, bytes: Array.from(attachment.bytes) });
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(attachment.bytes)], { type: 'application/pdf' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <button className="text-button pdf-link" onClick={() => setOpen(true)}>
        ▤ {children}
      </button>
      {open && (
        <Modal title={attachment?.name || 'PDF-Dokument'} onClose={() => setOpen(false)} width={860}>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="settings-actions">
            <Action label="Zurück" isDisabled={!pdf || page === 1} onClick={() => setPage((p) => p - 1)} />
            <span>{pdf ? `Seite ${page} / ${pdf.numPages}` : 'PDF wird geladen …'}</span>
            <Action
              label="Weiter"
              isDisabled={!pdf || page === pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            />
            <Action label="PDF speichern" isDisabled={!attachment} onClick={() => void download()} />
          </div>
          <canvas className="pdf-canvas" ref={canvas} aria-label={`PDF Seite ${page}`} />
        </Modal>
      )}
    </>
  );
}
