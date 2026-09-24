// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { newNote } from './domain';

const note = newNote('local', '# Verlauf prüfen\nEine Notiz für die Navigation.');
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./Login', () => ({ WebAccess: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./state', () => ({
  useNotto: () => ({
    notes: [note],
    scope: 'local',
    user: null,
    loading: false,
    notify: vi.fn(),
    notice: '',
    sync: vi.fn(),
    syncState: 'local',
    syncError: '',
  }),
}));
vi.mock('./Knowledge', () => ({ Knowledge: () => null, IntelligenceWorker: () => null }));
vi.mock('./Tasks', () => ({ TasksPage: () => null, useKnowledgeRecords: () => [] }));
vi.mock('./FloatingSearch', () => ({ FloatingSearch: () => null }));
vi.mock('./drafts', () => ({ useNewDrafts: () => [] }));
vi.mock('./Editor', () => ({ Editor: () => <div data-testid="editor" /> }));
vi.mock('./Settings', () => ({ Settings: () => null }));
vi.mock('./Widget', () => ({ Widget: () => null }));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

it('keeps note navigation in browser back and forward history', async () => {
  window.history.replaceState(null, '', '/');
  const view = render(<App />);
  fireEvent.click(view.container.querySelector('.note-card')!);
  await waitFor(() => expect(window.location.search).toContain(`note=${note.id}`));
  expect(screen.getByTestId('editor')).toBeTruthy();

  window.history.back();
  await waitFor(() => expect(window.location.search).toBe(''));
  await waitFor(() => expect(screen.queryByTestId('editor')).toBeNull());

  window.history.forward();
  await waitFor(() => expect(window.location.search).toContain(`note=${note.id}`));
  await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
});
