import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop } from './repository';
export interface ShortcutStatus {
  shortcut: string;
  active: boolean;
  error: string | null;
}
export const shortcutOptions = [
  { value: 'Control+Shift+Space', label: 'Strg + Umschalt + Leertaste', compact: 'Strg ⇧ Leertaste' },
  { value: 'Control+Alt+Shift+KeyN', label: 'Strg + Alt + Umschalt + N', compact: 'Strg Alt ⇧ N' },
  {
    value: 'Control+Alt+Shift+Space',
    label: 'Strg + Alt + Umschalt + Leertaste',
    compact: 'Strg Alt ⇧ Leertaste',
  },
];
export function shortcutLabel(value: string, compact = false) {
  const option = shortcutOptions.find((o) => o.value === value);
  return option ? (compact ? option.compact : option.label) : value;
}
export function useCaptureShortcut() {
  const [status, setStatus] = useState<ShortcutStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let closed = false,
      dispose: (() => void) | undefined;
    void listen<ShortcutStatus>('shortcut-changed', (e) => {
      if (!closed) setStatus(e.payload);
    }).then((fn) => {
      if (closed) fn();
      else dispose = fn;
    });
    void invoke<ShortcutStatus>('shortcut_status')
      .then((s) => !closed && setStatus(s))
      .catch(
        () =>
          !closed &&
          setStatus({ shortcut: '', active: false, error: 'Tastenkürzel konnte nicht geprüft werden.' }),
      );
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);
  return status;
}
export function noteShortcut(e: KeyboardEvent, native: boolean) {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.getModifierState('AltGraph')) return false;
  return native
    ? e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n'
    : e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.code === 'Space';
}
export const newNoteLabel = desktop ? 'Strg N' : 'Strg ⇧ Leertaste';
