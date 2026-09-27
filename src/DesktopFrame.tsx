import { useEffect, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';

export function DesktopFrame({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const win = getCurrentWindow();
    let closed = false;
    let unlisten: (() => void) | undefined;
    const update = async () => {
      try {
        const value = await win.isMaximized();
        if (!closed) setMaximized(value);
      } catch {
        /* Window may already be closing. */
      }
    };
    void update();
    void win.onResized(update).then((fn) => (closed ? fn() : (unlisten = fn)));
    return () => {
      closed = true;
      unlisten?.();
    };
  }, [enabled]);
  if (!enabled) return children;
  const action = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError('');
    } catch {
      setError('Fensteraktion konnte nicht ausgeführt werden.');
    }
  };
  return (
    <div className="desktop-frame">
      <header className="desktop-titlebar" data-tauri-drag-region>
        <span className="desktop-brand" data-tauri-drag-region>
          <i />
          <b /> NOTO
        </span>
        {error && <span role="alert">{error}</span>}
        <div className="desktop-window-controls">
          <button aria-label="Minimieren" onClick={() => void action(() => getCurrentWindow().minimize())}>
            <Minus size={15} />
          </button>
          <button
            aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'}
            onClick={() => void action(() => getCurrentWindow().toggleMaximize())}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            className="desktop-close"
            aria-label="Fenster schließen"
            onClick={() => void action(() => getCurrentWindow().close())}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
