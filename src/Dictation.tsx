import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Action, Modal } from './components';
import { request } from './intelligence';

function RecordingWaveform({ stream }: { stream: MediaStream }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSeconds((value) => value + 1), 1000);
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame = 0;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      void context.resume().catch(() => undefined);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const levels = new Float32Array(8);
      analyser.smoothingTimeConstant = 0.3;
      const binHz = context.sampleRate / analyser.fftSize;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let last = 0;
      const draw = (time: number) => {
        frame = requestAnimationFrame(draw);
        if (time - last < (reduced ? 250 : 16)) return;
        last = time;
        const element = canvas.current;
        const pen = element?.getContext('2d');
        if (!element || !pen) return;
        analyser.getByteFrequencyData(samples);
        const { width, height } = element;
        pen.clearRect(0, 0, width, height);
        pen.fillStyle = getComputedStyle(element).color;
        const slot = width / levels.length;
        const barWidth = slot * 0.55;
        levels.forEach((previous, index) => {
          // Logarithmic bands spread the speech range across all bars.
          const start = Math.max(1, Math.floor((80 * 100 ** (index / levels.length)) / binHz));
          const end = Math.min(
            samples.length,
            Math.max(start + 1, Math.ceil((80 * 100 ** ((index + 1) / levels.length)) / binHz)),
          );
          let sum = 0;
          for (let bin = start; bin < end; bin++) sum += samples[bin] ** 2;
          const level = Math.min(1, (Math.sqrt(sum / Math.max(1, end - start)) / 255) * 1.5);
          levels[index] = previous + (level - previous) * (level > previous ? 0.95 : 0.2);
          const barHeight = Math.max(6, levels[index] * height * 0.9);
          pen.beginPath();
          pen.roundRect(
            index * slot + (slot - barWidth) / 2,
            (height - barHeight) / 2,
            barWidth,
            barHeight,
            Math.min(barWidth / 2, barHeight / 2),
          );
          pen.fill();
        });
      };
      frame = requestAnimationFrame(draw);
    } catch {
      // Recording remains available even when audio analysis is unsupported.
    }
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(frame);
      source?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    };
  }, [stream]);
  return (
    <div className="recording-monitor">
      <div className="recording-status">
        <span role="status">● Aufnahme läuft</span>
        <time>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} / 3:00
        </time>
      </div>
      <canvas ref={canvas} width={800} height={120} aria-hidden="true" />
    </div>
  );
}

export function Dictation({ scope, onInsert }: { scope: string; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false),
    [recording, setRecording] = useState(false),
    [starting, setStarting] = useState(false),
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
    if (starting || recording) return;
    setStarting(true);
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
      stream.current?.getTracks().forEach((track) => track.stop());
      if (alive.current && !cancelled.current) setError(String(e));
    } finally {
      if (alive.current) setStarting(false);
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
        <Modal title="Gedanken einsprechen" onClose={close} className="dictation-dialog">
          <p className="muted">
            Die Aufnahme (maximal drei Minuten) wird nach dem Stoppen an OpenAI zur Transkription gesendet.
            Prüfe den Text, bevor du ihn einfügst.
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {recording && stream.current && <RecordingWaveform stream={stream.current} />}
          <div className="settings-actions dictation-actions">
            {recording ? (
              <Action label="Aufnahme stoppen" icon={<Square size={16} />} variant="primary" onClick={stop} />
            ) : (
              <Action
                label={starting ? 'Mikrofon wird geöffnet …' : 'Aufnahme starten'}
                icon={<Mic size={16} />}
                isDisabled={busy || starting}
                onClick={() => void start()}
              />
            )}
            <Action label="Abbrechen" onClick={close} />
          </div>
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
