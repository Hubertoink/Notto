import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Action, Modal } from './components';
import { request } from './intelligence';

export function Dictation({ scope, onInsert }: { scope: string; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(''),
    [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    audio = useRef<Blob | null>(null),
    alive = useRef(true),
    cancelled = useRef(false);
  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    clearTimeout(timer.current);
    setRecording(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      clearTimeout(timer.current);
    };
  }, []);
  async function transcribe(blob: Blob) {
    setBusy(true);
    setError('');
    try {
      if (blob.size > 12 * 1024 * 1024) throw new Error('Aufnahme zu groß. Bitte kürzer diktieren.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let encoded = '';
      for (let i = 0; i < bytes.length; i += 8192)
        encoded += String.fromCharCode(...bytes.slice(i, i + 8192));
      const result = await request(scope, 'audio/transcriptions', {
        audio: btoa(encoded),
        mime: blob.type.split(';')[0],
      });
      if (typeof result.text !== 'string') throw new Error('Keine Transkription erhalten.');
      if (alive.current && !cancelled.current) setText(result.text);
    } catch (e) {
      if (alive.current && !cancelled.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function start() {
    setError('');
    setText('');
    cancelled.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error('Dieses Gerät unterstützt die Aufnahme hier nicht.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || cancelled.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mime) {
        input.getTracks().forEach((t) => t.stop());
        throw new Error('Kein unterstütztes Aufnahmeformat verfügbar.');
      }
      const r = new MediaRecorder(input, { mimeType: mime });
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        input.getTracks().forEach((t) => t.stop());
        if (cancelled.current || !alive.current) return;
        audio.current = new Blob(chunks, { type: mime });
        void transcribe(audio.current);
      };
      r.onerror = () => {
        setError('Mikrofonaufnahme fehlgeschlagen.');
        stop();
      };
      r.start(1000);
      setRecording(true);
      timer.current = setTimeout(stop, 180000);
    } catch (e) {
      setError(String(e));
    }
  }
  const close = () => {
    cancelled.current = true;
    stop();
    audio.current = null;
    setOpen(false);
    setText('');
  };
  return (
    <>
      <Action
        label="Notiz diktieren"
        icon={<Mic size={18} />}
        variant="ghost"
        isIconOnly
        onClick={() => setOpen(true)}
      />
      {open && (
        <Modal title="Gedanken einsprechen" onClose={close}>
          <p className="muted">
            Die Aufnahme (maximal drei Minuten) wird nach dem Stoppen an OpenAI zur Transkription gesendet.
            Prüfe den Text, bevor du ihn einfügst.
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="settings-actions">
            {recording ? (
              <Action label="Aufnahme stoppen" icon={<Square size={16} />} variant="primary" onClick={stop} />
            ) : (
              <Action
                label="Aufnahme starten"
                icon={<Mic size={16} />}
                isDisabled={busy}
                onClick={() => void start()}
              />
            )}
            <Action label="Abbrechen" onClick={close} />
          </div>
          {recording && <p role="status">Mikrofon aktiv · Aufnahme läuft</p>}
          {busy && <p role="status">Text wird erkannt …</p>}
          {error && audio.current && (
            <Action
              label="Transkription erneut versuchen"
              isDisabled={busy}
              onClick={() => void transcribe(audio.current!)}
            />
          )}
          {text && (
            <>
              <label>
                Transkription prüfen
                <textarea value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <Action
                label="In Notiz einfügen"
                variant="primary"
                onClick={() => {
                  onInsert(text);
                  close();
                }}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}
