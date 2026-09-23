// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { newNote } from './domain';
import { db, repo } from './repository';

const state = vi.hoisted(() => ({ note: null as ReturnType<typeof newNote> | null }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./Login', () => ({ WebAccess: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./state', () => ({
  useNotto: () => ({
    notes: state.note ? [state.note] : [],
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
vi.mock('./Tasks', () => ({
  TasksPage: () => null,
  useKnowledgeRecords: () => [
    {
      id: 'collection',
      scope: 'local',
      noteId: 'collection',
      revision: '1',
      kind: 'collection',
      at: '',
      data: { name: 'Jugendarbeit' },
    },
  ],
}));
vi.mock('./FloatingSearch', () => ({ FloatingSearch: () => null }));
vi.mock('./drafts', () => ({ useNewDrafts: () => [] }));
vi.mock('./Editor', () => ({ Editor: () => null }));
vi.mock('./Settings', () => ({ Settings: () => null }));
vi.mock('./Widget', () => ({ Widget: () => null }));

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).animate;
  state.note = null;
  localStorage.clear();
  await db.notes.clear();
});

it('adds a dragged note when dropped anywhere on the collection row', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
  state.note = newNote('local', '# Notiz für Jugendarbeit\nLängerer Text, der beim Ziehen verdeckt.');
  await repo.put(state.note, null);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const animate = vi.fn(() => ({ finished }));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  localStorage.setItem('notto-sidebar-disclosures', JSON.stringify({ '["local","collections"]': false }));
  const { container } = render(<App />);
  const card = container.querySelector<HTMLButtonElement>('.note-card')!;
  const row = container.querySelector<HTMLDivElement>('.collection-row')!;
  const collections = container.querySelector<HTMLElement>('.collection-navigation')!;
  expect(collections.hidden).toBe(true);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    left: 20,
    top: 100,
    width: 200,
    height: 32,
  } as DOMRect);
  const data = {
    setData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: '',
    dropEffect: '',
  };
  const dragEvent = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'dataTransfer', { value: data });
    return event;
  };
  fireEvent(card, dragEvent('dragstart', 250, 220));
  expect(collections.hidden).toBe(false);
  expect(card.classList.contains('note-card-dragging')).toBe(true);
  expect(container.querySelector('.notebook')?.classList.contains('note-drag-active')).toBe(true);
  expect(data.setDragImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0);
  expect(container.querySelector('.note-drag-transparent-image')).not.toBeNull();
  const preview = container.querySelector<HTMLElement>('.note-drag-preview')!;
  expect(preview.textContent).toContain('Notiz für Jugendarbeit');
  expect(preview.textContent).not.toContain('Längerer Text');
  expect(preview.style.left).toBe('158px');
  fireEvent(row, dragEvent('dragover', 300, 230));
  expect(preview.style.left).toBe('208px');
  expect(row.classList.contains('collection-drop-target')).toBe(true);
  fireEvent(row.querySelector('.collection-toggle')!, dragEvent('drop', 250, 220));
  expect(container.querySelector('.notebook')?.classList.contains('note-drag-active')).toBe(false);
  expect(container.querySelector('.note-drag-preview')).toBeNull();
  expect(container.querySelector('.note-drag-transparent-image')).toBeNull();
  expect(animate.mock.contexts).toContain(row);
  expect(container.querySelector('.note-drag-flight')?.textContent).toContain('Notiz für Jugendarbeit');
  expect(container.querySelector('.note-drag-flight')?.textContent).not.toContain('Längerer Text');
  await waitFor(async () =>
    expect((await repo.get('local', state.note!.id))?.collections).toEqual(['Jugendarbeit']),
  );
  finish();
  fireEvent.dragStart(card, { dataTransfer: data });
  fireEvent.dragEnd(card, { dataTransfer: data });
  expect(container.querySelector('.notebook')?.classList.contains('note-drag-active')).toBe(false);
  expect(container.querySelector('.note-drag-preview')).toBeNull();
});
