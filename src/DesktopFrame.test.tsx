// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopFrame } from './DesktopFrame';
const win = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(true),
  onResized: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('uses native window controls including close rather than terminating the process', async () => {
  render(
    <DesktopFrame enabled>
      <p>Notizen</p>
    </DesktopFrame>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Wiederherstellen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Minimieren' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fenster schließen' }));
  await waitFor(() => expect(win.close).toHaveBeenCalledOnce());
  expect(win.minimize).toHaveBeenCalledOnce();
  expect(win.toggleMaximize).toHaveBeenCalledOnce();
});
it('does not add window chrome or call native APIs on web and widget', () => {
  render(
    <DesktopFrame enabled={false}>
      <p>Notizen</p>
    </DesktopFrame>,
  );
  expect(screen.queryByRole('banner')).toBeNull();
  expect(win.isMaximized).not.toHaveBeenCalled();
});
