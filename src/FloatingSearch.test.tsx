// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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
afterEach(cleanup);
it('focuses search, filters across notes, excludes trash and opens with Enter', () => {
  const note = newNote('local', '#medien Steam einrichten');
  const onSelect = vi.fn(),
    onClose = vi.fn();
  render(
    <FloatingSearch
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
