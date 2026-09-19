// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { noteShortcut } from './shortcuts';
vi.mock('./repository', () => ({ desktop: false }));
it('keeps browser window and incognito shortcuts untouched', () => {
  expect(noteShortcut(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }), false)).toBe(false);
  expect(noteShortcut(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true }), false)).toBe(
    false,
  );
  expect(
    noteShortcut(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
      false,
    ),
  ).toBe(true);
});
it('accepts only the exact desktop combination and ignores repeats, composition and consumed events', () => {
  expect(noteShortcut(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true }), true)).toBe(true);
  for (const extra of [
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
  ]) {
    expect(noteShortcut(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, ...extra }), true)).toBe(
      false,
    );
  }
  const consumed = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true });
  consumed.preventDefault();
  expect(noteShortcut(consumed, true)).toBe(false);
});
