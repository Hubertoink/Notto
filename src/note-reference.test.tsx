// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { noteLinkHref } from './note-links';

const fixtures = vi.hoisted(() => {
  const make = (id: string, content: string) => ({
    id,
    scope: 'local',
    content,
    createdAt: '',
    updatedAt: '',
    revision: crypto.randomUUID(),
    baseRevision: null,
    dirty: false,
    pinned: false,
    archived: false,
    deleted: false,
    history: [],
  });
  return {
    first: make(
      '11111111-1111-4111-8111-111111111111',
      'Erste Zielnotiz\n\nEine Vorschau auf den ersten Inhalt.',
    ),
    second: make(
      '22222222-2222-4222-8222-222222222222',
      'Zweite Zielnotiz\n\nEine Vorschau auf den zweiten Inhalt.',
    ),
  };
});
vi.mock('./repository', () => ({ desktop: false }));
vi.mock('./cloud', () => ({ fetchAttachment: vi.fn() }));
vi.mock('./state', () => ({
  useNotto: () => ({ notes: [fixtures.first, fixtures.second], notify: vi.fn() }),
}));
import { NoteMarkdown } from './components';

afterEach(cleanup);

it('shows destination previews and lets a shared term choose between several notes', () => {
  const opened = vi.fn();
  window.addEventListener('notto-open-note', opened);
  const href = noteLinkHref([
    { id: fixtures.first.id, relation: 'theory' },
    { id: fixtures.second.id, relation: 'context' },
  ]);
  render(<NoteMarkdown scope="local" content={`Der [gemeinsame Begriff](${href}) verbindet beide.`} />);

  const trigger = screen.getByRole('button', { name: /gemeinsame Begriff2/ });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('Erste Zielnotiz')).toBeTruthy();
  expect(screen.getByText('Eine Vorschau auf den zweiten Inhalt.')).toBeTruthy();
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: /Zweite Zielnotiz/ }));
  expect((opened.mock.calls[0][0] as CustomEvent).detail.id).toBe(fixtures.second.id);
  window.removeEventListener('notto-open-note', opened);
});
