// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteCommands } from './NoteCommands';
import { serverRequest } from './backend';
import type { NoteCommand } from './note-command';
vi.mock('./backend', () => ({ serverRequest: vi.fn() }));
vi.mock('./cloud', () => ({ ownBackend: () => true, readCloudConfig: () => ({ url: 'https://noto.test' }) }));
vi.mock('./components', () => ({
  readableDate: () => 'Heute',
  Modal: ({ children }: any) => <div>{children}</div>,
  NoteMarkdown: ({ content }: any) => <p>{content}</p>,
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

const previous: NoteCommand = {
  id: 'old',
  note_id: 'note',
  revision: 'r',
  prompt: 'Lesempfehlungen zu Brooks',
  status: 'done',
  stage: 'Fertig',
  error: null,
  created_at: '2026-09-27T10:00:00Z',
  result: {
    summary: 'Altes Ergebnis',
    items: [{ title: 'Alter Titel', detail: 'Bisheriger Inhalt' }],
    sources: [],
    warnings: [],
  },
};

it('puts the retry icon in the date row and keeps one request with its previous result while restarting', async () => {
  vi.mocked(serverRequest).mockResolvedValue({ commands: [previous] });
  const onCount = vi.fn();
  const onStart = vi.fn(async (prompt, id) => ({
    ...previous,
    id,
    prompt,
    status: 'pending' as const,
    stage: 'Wartet',
    result: null,
    created_at: '2026-09-27T11:00:00Z',
  }));
  render(
    <NoteCommands
      scope="user"
      noteId="note"
      content="Brooks"
      editing={false}
      dirty={false}
      onStart={onStart}
      onCount={onCount}
    />,
  );
  const retry = await screen.findByRole('button', { name: 'Auftrag erneut ausführen' });
  expect(retry.closest('header')?.querySelector('time')).toBeTruthy();
  expect(retry.textContent).toBe('');
  fireEvent.click(retry);
  await screen.findByText('Wartet');
  expect(screen.getByText('Altes Ergebnis')).toBeTruthy();
  expect(screen.getByText('Bisheriges Ergebnis · wird bei Erfolg ersetzt')).toBeTruthy();
  expect(document.querySelectorAll('.command-run')).toHaveLength(1);
  expect(onCount).toHaveBeenLastCalledWith(1);
  expect(screen.queryByRole('button', { name: 'Auftrag erneut ausführen' })).toBeNull();
});

it.each(['done', 'failed', 'cancelled', 'empty'] as const)(
  'shows only the newest usable result after reopening: %s',
  async (outcome) => {
    const latest: NoteCommand = {
      ...previous,
      id: 'new',
      created_at: '2026-09-27T11:00:00Z',
      status: outcome === 'empty' ? 'done' : outcome,
      error: outcome === 'failed' ? 'Websuche fehlgeschlagen' : null,
      result:
        outcome === 'done'
          ? {
              ...previous.result!,
              summary: 'Neues Ergebnis',
              items: [{ title: 'Neuer Titel', detail: 'Neue Empfehlung' }],
            }
          : outcome === 'empty'
            ? { summary: 'Keine Quellen gefunden', items: [], sources: [], warnings: [] }
            : null,
    };
    vi.mocked(serverRequest).mockResolvedValue({ commands: [previous, latest] });
    render(
      <NoteCommands
        scope="user"
        noteId="note"
        content="Brooks"
        editing={false}
        dirty={false}
        onStart={vi.fn()}
      />,
    );
    await screen.findByText(outcome === 'done' ? 'Neues Ergebnis' : 'Altes Ergebnis');
    expect(document.querySelectorAll('.command-run')).toHaveLength(1);
    if (outcome === 'done') expect(screen.queryByText('Altes Ergebnis')).toBeNull();
    else expect(screen.getByText('Bisheriges Ergebnis · kein neues Ergebnis übernommen')).toBeTruthy();
  },
);

it('keeps the last result during a network outage and refreshes on reconnect without a fetch error', async () => {
  vi.mocked(serverRequest)
    .mockResolvedValueOnce({ commands: [previous] })
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue({
      commands: [{ ...previous, result: { ...previous.result!, summary: 'Aktuelles Ergebnis' } }],
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
  await screen.findByText('Altes Ergebnis');
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(serverRequest).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Altes Ergebnis')).toBeTruthy();
  expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  fireEvent(window, new Event('online'));
  await screen.findByText('Aktuelles Ergebnis');
});
