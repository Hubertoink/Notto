// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Widget } from './Widget';

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
  motion: { div: 'div' },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('./repository', () => ({ desktop: false }));
vi.mock('./shortcuts', () => ({ useCaptureShortcut: () => null, shortcutLabel: () => '' }));
vi.mock('./components', () => ({
  Action: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button aria-label={label} onClick={onClick} />
  ),
}));
vi.mock('./Editor', () => ({ Editor: () => <div>Editor</div> }));
vi.mock('./state', () => ({
  useNotto: () => ({
    scope: 'local',
    notify: vi.fn(),
    notice: '',
    notes: [
      {
        id: 'one',
        content: '# Erster Gedanke',
        updatedAt: '2026-09-22T12:00:00Z',
        pinned: false,
        archived: false,
        deleted: false,
      },
      {
        id: 'two',
        content: '# Zweiter Gedanke',
        updatedAt: '2026-09-21T12:00:00Z',
        pinned: false,
        archived: false,
        deleted: false,
      },
      {
        id: 'three',
        content: '# Dritter Gedanke',
        updatedAt: '2026-09-20T12:00:00Z',
        pinned: false,
        archived: false,
        deleted: false,
      },
    ],
  }),
}));

afterEach(cleanup);

it('shows all three recent notes above the dedicated new-note footer', () => {
  render(<Widget />);
  fireEvent.click(screen.getByRole('button', { name: 'Noto öffnen' }));
  expect(screen.getByText('Erster Gedanke')).toBeTruthy();
  expect(screen.getByText('Zweiter Gedanke')).toBeTruthy();
  expect(screen.getByText('Dritter Gedanke')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Neue Notiz' })).toBeTruthy();
});
