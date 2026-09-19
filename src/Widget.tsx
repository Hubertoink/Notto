import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, GripVertical, Plus, X, FileText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { desktop } from './repository';
import { useNotto } from './state';
import { titleOf } from './domain';
import { Action } from './components';
import { Editor } from './Editor';
import { useCaptureShortcut, shortcutLabel } from './shortcuts';

export function Widget() {
  const shortcut = useCaptureShortcut();
  const { notes, scope, notify, notice } = useNotto();
  const [mode, setMode] = useState<'idle' | 'peek' | 'edit'>('idle');
  const [side, setSide] = useState<'left' | 'right'>('right');
  const reduced = useReducedMotion();
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resize = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pinned = useRef(false);
  const [editorKey, setEditorKey] = useState(0);
  const change = useCallback(
    (next: typeof mode) => {
      clearTimeout(resize.current);
      clearTimeout(hover.current);
      clearTimeout(close.current);
      setMode(next);
      modeRef.current = next;
      if (desktop) {
        if (next === 'idle')
          resize.current = setTimeout(
            () => void invoke('widget_mode', { mode: next }).catch((e) => notify(String(e))),
            reduced ? 0 : 300,
          );
        else void invoke('widget_mode', { mode: next }).catch((e) => notify(String(e)));
      }
    },
    [notify, reduced],
  );
  useEffect(() => {
    if (!desktop) return;
    let closed = false;
    const dispose: (() => void)[] = [];
    const keep = (fn: () => void) => (closed ? fn() : dispose.push(fn));
    let moved: ReturnType<typeof setTimeout> | undefined;
    void listen('quick-capture', () => {
      pinned.current = true;
      change('edit');
      window.dispatchEvent(new Event('noto-focus-capture'));
      setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 100);
    }).then(keep);
    void listen<'left' | 'right'>('dock-side', (e) => setSide(e.payload)).then(keep);
    void getCurrentWindow()
      .onMoved(() => {
        clearTimeout(moved);
        moved = setTimeout(
          () =>
            void invoke<'left' | 'right'>('snap_widget', { side: null }).then(setSide).catch(console.error),
          450,
        );
      })
      .then(keep);
    void invoke<'left' | 'right'>('snap_widget', { side: null }).then(setSide).catch(console.error);
    return () => {
      closed = true;
      dispose.forEach((fn) => fn());
      clearTimeout(moved);
    };
  }, [change]);
  useEffect(
    () => () => {
      clearTimeout(hover.current);
      clearTimeout(close.current);
      clearTimeout(resize.current);
    },
    [],
  );
  const recent = notes
    .filter((n) => !n.deleted && !n.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  function openMain(id: string | null) {
    if (desktop) void invoke('open_main', { noteId: id }).catch((e) => notify(String(e)));
    else location.href = '/';
    change('idle');
  }
  return (
    <div
      className={`widget-host ${desktop ? 'native-widget' : 'browser-widget'}`}
      data-side={side}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          pinned.current = false;
          change('idle');
        }
      }}
    >
      {!desktop && <p className="widget-preview-label">Noto · Randwidget-Vorschau</p>}
      <motion.div
        className={`widget-surface widget-${mode}`}
        initial={false}
        animate={{
          width: mode === 'idle' ? 48 : mode === 'peek' ? 344 : 464,
          height: mode === 'idle' ? 102 : mode === 'peek' ? 324 : 414,
          borderRadius: mode === 'idle' ? 24 : 22,
        }}
        transition={reduced ? { duration: 0 } : { duration: 0.29, ease: [0.22, 1, 0.36, 1] }}
        onPointerEnter={() => clearTimeout(close.current)}
        onPointerLeave={() => {
          clearTimeout(hover.current);
          close.current = setTimeout(() => {
            if (modeRef.current === 'peek' && !pinned.current) change('idle');
          }, 430);
        }}
      >
        {mode === 'idle' ? (
          <div className="widget-anchor">
            <button
              className="widget-logo"
              aria-label="Noto öffnen"
              onPointerEnter={(e) => {
                if (e.pointerType !== 'touch') hover.current = setTimeout(() => change('peek'), 240);
              }}
              onClick={() => {
                pinned.current = true;
                change('peek');
              }}
            >
              <img src="/noto.png" alt="" />
            </button>
            <button
              className="widget-grip"
              aria-label="Randwidget verschieben"
              onPointerDown={(e) => {
                if (e.button === 0 && desktop) {
                  clearTimeout(hover.current);
                  void getCurrentWindow()
                    .startDragging()
                    .catch((e) => notify(String(e)));
                }
              }}
            >
              <GripVertical size={17} />
            </button>
          </div>
        ) : mode === 'peek' ? (
          <motion.div
            className="widget-peek"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduced ? 0 : 0.09, duration: 0.12 }}
          >
            <div className="widget-heading">
              <strong>
                <img className="widget-heading-logo" src="/noto.png" alt="" />
                noto<span>.</span>
              </strong>
              <div className="toolbar">
                <Action
                  label="Notizbuch öffnen"
                  isIconOnly
                  icon={<ArrowUpRight size={17} />}
                  variant="ghost"
                  onClick={() => openMain(recent[0]?.id ?? null)}
                />
                <Action
                  label="Einklappen"
                  isIconOnly
                  icon={<X size={16} />}
                  variant="ghost"
                  onClick={() => {
                    pinned.current = false;
                    change('idle');
                  }}
                />
              </div>
            </div>
            <span className="eyebrow">ZULETZT FESTGEHALTEN</span>
            <div className="widget-notes">
              {recent.length ? (
                recent.map((n) => (
                  <button key={n.id} onClick={() => openMain(n.id)}>
                    <FileText size={16} />
                    <span>{titleOf(n.content)}</span>
                  </button>
                ))
              ) : (
                <p>
                  Noch keine Notizen.
                  <br />
                  Ein Gedanke genügt.
                </p>
              )}
            </div>
            <Action
              label="Neue Notiz"
              endContent={
                desktop && (
                  <kbd className="note-shortcut">
                    {shortcut?.active
                      ? shortcutLabel(shortcut.shortcut, true)
                      : shortcut
                        ? 'Kürzel prüfen'
                        : '…'}
                  </kbd>
                )
              }
              tooltip={
                shortcut?.active
                  ? `Überall unter Windows: ${shortcutLabel(shortcut.shortcut)}`
                  : shortcut?.error || undefined
              }
              icon={<Plus size={17} />}
              variant="primary"
              width="100%"
              onClick={() => {
                pinned.current = true;
                change('edit');
              }}
            />
            {desktop && shortcut && !shortcut.active && (
              <p className="shortcut-warning">
                Tastenkürzel nicht aktiv. Unter Einstellungen → Tastenkürzel prüfen.
              </p>
            )}
          </motion.div>
        ) : (
          <Editor
            key={`${scope}:${editorKey}`}
            compact
            onSaved={() => {
              setEditorKey((k) => k + 1);
              pinned.current = false;
              change('idle');
            }}
            onClose={() => {
              pinned.current = false;
              change('idle');
            }}
          />
        )}
      </motion.div>
      {notice && mode !== 'idle' && (
        <span className="widget-notice" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
