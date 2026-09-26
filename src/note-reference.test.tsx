// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('shows destination previews and lets a shared term choose between several notes', async () => {
  const opened = vi.fn();
  window.addEventListener('notto-open-note', opened);
  const href = noteLinkHref([
    { id: fixtures.first.id, relation: 'theory' },
    { id: fixtures.second.id, relation: 'context' },
  ]);
  render(<NoteMarkdown scope="local" content={`Der [gemeinsame Begriff](${href}) verbindet beide.`} />);

  const trigger = screen.getByRole('button', { name: /gemeinsame Begriff2/ });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.pointerEnter(trigger.closest('.note-reference-wrap')!);
  expect(await screen.findByRole('menu')).toBeTruthy();
  expect(screen.getByText('Erste Zielnotiz')).toBeTruthy();
  expect(screen.getByText('Eine Vorschau auf den zweiten Inhalt.')).toBeTruthy();
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: /Zweite Zielnotiz/ }));
  expect((opened.mock.calls[0][0] as CustomEvent).detail.id).toBe(fixtures.second.id);
  window.removeEventListener('notto-open-note', opened);
});

it('keeps a preview inside the visible window near its right edge', async () => {
  render(
    <NoteMarkdown
      scope="local"
      content={`[Randbegriff](${noteLinkHref([{ id: fixtures.first.id, relation: 'context' }])})`}
    />,
  );
  const link = screen.getByRole('link', { name: /Randbegriff/ });
  const anchor = link.closest('.note-reference-wrap')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    left: 1000,
    right: 1060,
    top: 80,
    bottom: 104,
    width: 60,
    height: 24,
    x: 1000,
    y: 80,
    toJSON: () => ({}),
  });
  fireEvent.pointerEnter(anchor);
  const tooltip = await screen.findByRole('tooltip');
  await waitFor(() => expect(tooltip.style.left).toBe('672px'));
  expect(tooltip.style.visibility).toBe('visible');
});
