// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dictation } from './Dictation';
import { request } from './intelligence';
vi.mock('./intelligence', () => ({ request: vi.fn() }));
vi.mock('./components', () => ({
  Action: ({ label, onClick, isDisabled }: any) => (
    <button disabled={isDisabled} onClick={onClick}>
      {label}
    </button>
  ),
  Modal: ({ children, className }: any) => <div className={className}>{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('releases microphone and analyser when the recording is cancelled without transcribing', async () => {
  const stop = vi.fn();
  const disconnect = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      createAnalyser() {
        return { fftSize: 1024 };
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect };
      }
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'MediaRecorder',
    class {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      onstop?: () => void;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.());
      }
    },
  );
  render(<Dictation scope="test" onInsert={vi.fn()} />);
  fireEvent.click(screen.getByText('Notiz diktieren'));
  fireEvent.click(screen.getByText('Aufnahme starten'));
  await screen.findByText('● Aufnahme läuft');
  fireEvent.click(screen.getByText('Abbrechen'));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(stop).toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});
it('releases a microphone permission result arriving after dismissal', async () => {
  const stop = vi.fn();
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  vi.stubGlobal('MediaRecorder', class {});
  render(<Dictation scope="test" onInsert={vi.fn()} />);
  fireEvent.click(screen.getByText('Notiz diktieren'));
  fireEvent.click(screen.getByText('Aufnahme starten'));
  fireEvent.click(screen.getByText('Abbrechen'));
  resolve({ getTracks: () => [{ stop }] });
  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(request).not.toHaveBeenCalled();
});
