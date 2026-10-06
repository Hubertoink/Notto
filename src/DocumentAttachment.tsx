import { useState, type ReactNode } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal } from './components';
import { fetchAttachment } from './cloud';
import { desktop } from './repository';
import { documentText } from './document-text';

export function DocumentAttachment({
  scope,
  id,
  name,
  children,
}: {
  scope: string;
  id: string;
  name?: string;
  children: ReactNode;
}) {
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  async function load(download = false) {
    setError('');
    try {
      const attachment = await fetchAttachment(scope, id);
      if (!attachment) throw new Error('Datei fehlt. Bitte synchronisieren.');
      if (!download) {
        setText(documentText(id, attachment.bytes));
        return;
      }
      const filename = name || attachment.name;
      if (desktop) {
        const path = await save({ defaultPath: filename });
        if (path) await invoke('write_export', { path, bytes: Array.from(attachment.bytes) });
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(attachment.bytes)], { type: attachment.mime }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <>
      <button
        className="text-button pdf-link"
        onClick={() => {
          setOpen(true);
          setText(null);
          void load();
        }}
      >
        {children}
      </button>
      {open && (
        <Modal title={name || 'Dokument'} width={860} onClose={() => setOpen(false)}>
          <p className="muted">
            Textvorschau · Formatierungen und eingebettete Bilder werden nicht angezeigt.
          </p>
          <Action label="Originaldatei speichern" onClick={() => void load(true)} />
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <pre className="document-text">{text ?? 'Dokument wird gelesen …'}</pre>
          )}
        </Modal>
      )}
    </>
  );
}
