// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteCommands } from './NoteCommands';
import { serverRequest } from './backend';
vi.mock('./backend', () => ({ serverRequest: vi.fn() }));
vi.mock('./cloud', () => ({ ownBackend: () => true, readCloudConfig: () => ({ url: 'https://noto.test' }) }));
vi.mock('./components', () => ({
  readableDate: () => 'Heute',
  Modal: ({ children }: any) => <div>{children}</div>,
  Sources: ({ sources }: any) => (
    <details>
      <summary>Quellen</summary>
      {sources.map((source: any) => (
        <a key={source.url} href={source.url}>
          {source.title}
        </a>
      ))}
    </details>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('keeps unsaved typing inert and offers save and start without a repeated hint', async () => {
  vi.mocked(serverRequest).mockResolvedValue({ commands: [] });
  const onStart = vi.fn(async (prompt, id) => ({
    id,
    note_id: 'note',
    revision: 'r',
    prompt,
    status: 'pending' as const,
    stage: 'Wartet',
    error: null,
    result: null,
    created_at: new Date().toISOString(),
  }));
  render(
    <NoteCommands
      scope="user"
      noteId="note"
      content={'Titel\n/ki Fasse die Seite zusammen'}
      editing
      dirty
      onStart={onStart}
    />,
  );
  await waitFor(() => expect(serverRequest).toHaveBeenCalled());
  expect(onStart).not.toHaveBeenCalled();
  expect(screen.queryByText('Startet beim Speichern.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Speichern & starten' }));
  await waitFor(() => expect(screen.getByText('Wartet')).toBeTruthy());
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onStart.mock.calls[0][0]).toBe('Fasse die Seite zusammen');
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  await waitFor(() =>
    expect(vi.mocked(serverRequest).mock.calls.some((call) => call[1].endsWith('/cancel'))).toBe(true),
  );
});
it('loads completed results again after reopening the note', async () => {
  vi.mocked(serverRequest).mockResolvedValue({
    commands: [
      {
        id: 'id',
        prompt: 'Recherche',
        status: 'done',
        stage: 'Fertig',
        created_at: new Date().toISOString(),
        result: {
          summary: 'Gefundene Komponenten',
          items: [{ title: 'Archiv', detail: 'Für die Ablage', url: 'https://example.com' }],
          sources: [],
          warnings: [],
        },
      },
    ],
  });
  render(
    <NoteCommands
      scope="user"
      noteId="note"
      content="Titel"
      editing={false}
      dirty={false}
      onStart={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText('Gefundene Komponenten')).toBeTruthy());
  fireEvent.click(screen.getAllByText('Quellen')[0]);
  expect(screen.getByRole('link', { name: 'Archiv' }).getAttribute('href')).toBe('https://example.com');
});
