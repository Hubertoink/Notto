// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Settings } from './Settings';
const environment = vi.hoisted(() => ({ desktop: false }));
vi.mock('./components', () => ({
  Action: ({ label, onClick }: any) => <button onClick={onClick}>{label}</button>,
  Modal: ({ children }: any) => <div>{children}</div>,
  readableDate: () => '',
}));
vi.mock('./state', () => ({ useNotto: () => ({ scope: 'local', user: null }) }));
vi.mock('./repository', () => ({
  get desktop() {
    return environment.desktop;
  },
  repo: {},
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('') }));
vi.mock('./export', () => ({ exportNotebook: vi.fn() }));
vi.mock('./cloud', () => ({
  configured: () => true,
  readCloudConfig: () => ({ url: '' }),
  ownBackend: () => true,
}));
vi.mock('./shortcuts', () => ({ useCaptureShortcut: () => null, shortcutOptions: [{ value: 'test' }] }));
afterEach(() => {
  cleanup();
  environment.desktop = false;
  localStorage.clear();
});
it('shows one settings category at a time and keeps account input when switching', () => {
  const onImport = vi.fn();
  render(
    <Settings
      mode="system"
      setMode={vi.fn()}
      noteBackground="none"
      setNoteBackground={vi.fn()}
      onClose={vi.fn()}
      onImport={onImport}
    />,
  );
  expect(screen.queryByRole('textbox', { name: 'E-Mail' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Konto & Sync' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'E-Mail' }), {
    target: { value: 'test@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Deine Daten' }));
  expect(screen.queryByRole('textbox', { name: 'E-Mail' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Markdown importieren' }));
  expect(onImport).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Konto & Sync' }));
  expect((screen.getByRole('textbox', { name: 'E-Mail' }) as HTMLInputElement).value).toBe(
    'test@example.com',
  );
});

it('shows the installed version and persists automatic update checks', () => {
  environment.desktop = true;
  render(
    <Settings
      mode="system"
      setMode={vi.fn()}
      noteBackground="none"
      setNoteBackground={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  expect(screen.getByText(/Installierte Version/)).toBeTruthy();
  const automatic = screen.getByRole('checkbox', {
    name: /Automatisch nach Updates suchen/,
  }) as HTMLInputElement;
  expect(automatic.checked).toBe(true);
  fireEvent.click(automatic);
  expect(localStorage.getItem('notto-auto-update-check')).toBe('false');
});
