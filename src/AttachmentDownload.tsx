import { useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Action } from './components';
import { fetchAttachment } from './cloud';
import { desktop } from './repository';
import { Download, LoaderCircle } from 'lucide-react';

export function AttachmentDownload({ scope, id, name }: { scope: string; id: string; name: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const attachment = await fetchAttachment(scope, id);
      if (!attachment) throw new Error('Datei fehlt. Bitte synchronisieren.');
      if (desktop) {
        const path = await save({
          defaultPath: name,
          filters: [{ name: 'Dokument', extensions: [id.split('.').at(-1)!] }],
        });
        if (path) await invoke('write_export', { path, bytes: Array.from(attachment.bytes) });
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(attachment.bytes)], { type: attachment.mime }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download fehlgeschlagen.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div>
      <Action
        label={
          busy ? 'Datei wird geladen …' : id.endsWith('.pdf') ? 'PDF herunterladen' : 'Datei herunterladen'
        }
        isDisabled={busy}
        tooltip={
          busy ? 'Datei wird geladen …' : id.endsWith('.pdf') ? 'PDF herunterladen' : 'Datei herunterladen'
        }
        icon={busy ? <LoaderCircle size={18} className="command-spin" /> : <Download size={18} />}
        isIconOnly
        variant="ghost"
        onClick={() => void download()}
      />
      {error && (
        <p className="inline-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
