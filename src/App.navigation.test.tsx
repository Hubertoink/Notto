// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { newNote } from './domain';

const note = newNote('local', '# Verlauf prüfen\nEine Notiz für die Navigation.');
let testNotes = [note];
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./Login', () => ({ WebAccess: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./state', () => ({
  useNotto: () => ({
    notes: testNotes,
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
  testNotes = [note];
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

it('counts documents before hiding library rows in All Notes and respects collection filters', () => {
  const document = {
    ...newNote('local', '[Konzept](attachments/abc.pdf)'),
    collections: ['Jugendarbeit'],
    document: { attachmentId: 'abc.pdf', name: 'Konzept', mime: 'application/pdf', version: 1 },
  };
  const attached = { ...newNote('local', '[Anhang](attachments/def.pdf)'), collections: ['Jugendarbeit'] };
  testNotes = [
    note,
    document,
    attached,
    {
      ...document,
      id: 'archived',
      archived: true,
      document: { ...document.document, attachmentId: 'aaa.pdf' },
    },
    {
      ...document,
      id: 'deleted',
      deleted: true,
      document: { ...document.document, attachmentId: 'bbb.pdf' },
    },
  ];
  const view = render(<App />);
  expect(view.container.querySelector('.list-heading p')?.textContent).toBe('2 Notizen · 2 Dokumente');
  expect(view.container.querySelectorAll('.note-list .note-card')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^Jugendarbeit\s*2$/ }));
  expect(view.container.querySelector('.list-heading p')?.textContent).toBe('1 Notiz · 2 Dokumente');
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
