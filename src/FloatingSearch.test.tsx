// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FloatingSearch } from './FloatingSearch';
import { newNote } from './domain';
vi.mock('motion/react', () => ({ useReducedMotion: () => true, motion: { button: 'button', div: 'div' } }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const semanticSearch = vi.hoisted(() => vi.fn());
const ask = vi.hoisted(() => vi.fn());
vi.mock('./components', () => ({ NoteMarkdown: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('./intelligence', () => ({
  config: () => ({ enabled: true }),
  eligible: () => true,
  semanticSearch,
  ask,
}));
afterEach(() => {
  cleanup();
  semanticSearch.mockReset();
  ask.mockReset();
});
it('adds semantic matches to the same search without duplicating direct matches', async () => {
  const direct = newNote('local', 'Medienraum');
  const related = newNote('local', 'Steam für vier Computer einrichten');
  semanticSearch.mockResolvedValue([
    { noteId: direct.id, revision: direct.revision, text: direct.content, score: 0.9 },
    { noteId: related.id, revision: related.revision, text: related.content, score: 0.8 },
    { noteId: related.id, revision: related.revision, text: related.content, score: 0.7 },
  ]);
  render(
    <FloatingSearch
      scope="local"
      open
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSelect={vi.fn()}
      notes={[direct, related]}
    />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Medienraum' } });
  expect(semanticSearch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Sinngemäß suchen/ }));
  await screen.findByText('Sinngemäßer KI-Treffer');
  expect(screen.getByText('2 Treffer')).toBeTruthy();
  expect(screen.getByText('1 zusätzliche KI-Treffer')).toBeTruthy();
});
it('retains direct results on AI failure and clears stale AI results when the query changes', async () => {
  const note = newNote('local', 'Steam einrichten');
  semanticSearch.mockRejectedValue(new Error('KI vorübergehend nicht erreichbar'));
  render(
    <FloatingSearch
      scope="local"
      open
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSelect={vi.fn()}
      notes={[note]}
    />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Steam' } });
  fireEvent.click(screen.getByRole('button', { name: /Sinngemäß suchen/ }));
  await screen.findByRole('alert');
  expect(screen.getByText('1 Treffer')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'andere Suche' } });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByText('0 Treffer')).toBeTruthy();
});
it('focuses search, filters across notes, excludes trash and opens with Enter', () => {
  const note = newNote('local', '#medien Steam einrichten');
  const onSelect = vi.fn(),
    onClose = vi.fn();
  render(
    <FloatingSearch
      scope="local"
      open
      onOpen={vi.fn()}
      onClose={onClose}
      onSelect={onSelect}
      notes={[note, { ...newNote('local', 'Steam gelöscht'), deleted: true }, newNote('local', 'Konzept')]}
    />,
  );
  const field = screen.getByRole('textbox', { name: 'Suchbegriff' });
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: '#medien' } });
  expect(screen.getByText('1 Treffer')).toBeTruthy();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith(note.id);
  expect(onClose).toHaveBeenCalled();
});

it('uses Enter for semantic search when no direct note matches', async () => {
  semanticSearch.mockResolvedValue([]);
  render(
    <FloatingSearch scope="local" open onOpen={vi.fn()} onClose={vi.fn()} onSelect={vi.fn()} notes={[]} />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Jugend' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  await waitFor(() => expect(semanticSearch).toHaveBeenCalledWith('local', 'Jugend', []));
});
it('answers questions on Enter without navigating away', async () => {
  ask.mockResolvedValue({ answer: 'Deine letzte Aufgabe stammt von heute.', citations: [], sources: [] });
  const select = vi.fn();
  render(
    <FloatingSearch scope="local" open onOpen={vi.fn()} onClose={vi.fn()} onSelect={select} notes={[]} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Wann habe ich meine letzte Aufgabe angelegt?' },
  });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  await screen.findByText('Deine letzte Aufgabe stammt von heute.');
  expect(select).not.toHaveBeenCalled();
  expect(semanticSearch).not.toHaveBeenCalled();
});
