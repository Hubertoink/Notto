// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Sources, NoteMarkdown } from './components';
import { newNote, type Note } from './domain';
import { noteLink } from './note-tools';
import { uniqueSources } from './knowledge-policy';
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('./repository', () => ({ desktop: true }));
const data = vi.hoisted(() => ({ notes: [] as Note[] }));
vi.mock('./state', () => ({ useNotto: () => ({ notify: vi.fn(), notes: data.notes }) }));
afterEach(() => {
  cleanup();
  invoke.mockClear();
  data.notes = [];
});
it('deduplicates existing citations and opens desktop sources through the native browser command', () => {
  render(
    <Sources
      sources={[
        { title: 'Steam', url: 'https://store.steampowered.com/app/123/?utm_source=test' },
        { title: 'Steam again', url: 'https://store.steampowered.com/app/123/' },
      ]}
    />,
  );
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.click(screen.getByRole('link'));
  expect(invoke).toHaveBeenCalledWith('open_external', {
    url: 'https://store.steampowered.com/app/123/?utm_source=test',
  });
});
it('handles inline research links identically and excludes non-web sources', () => {
  render(<NoteMarkdown scope="local" content="[Quelle](https://example.com/path?a=1&b=2)" />);
  fireEvent.click(screen.getByRole('link'));
  expect(invoke).toHaveBeenCalledWith('open_external', { url: 'https://example.com/path?a=1&b=2' });
  expect(
    uniqueSources([
      { title: 'bad', url: 'file:///C:/test' },
      { title: 'bad', url: 'javascript:alert(1)' },
    ]),
  ).toEqual([]);
});

it('keeps compact sources collapsed and reveals their original links on demand', () => {
  const view = render(
    <Sources
      compact
      sources={[
        { title: 'Erste Quelle', url: 'https://example.com/one' },
        { title: 'Zweite Quelle', url: 'https://example.org/two' },
        { title: 'Duplikat', url: 'https://example.com/one' },
      ]}
    />,
  );
  expect(screen.getByText('+1')).toBeTruthy();
  expect(view.container.querySelector('details')?.open).toBe(false);
  fireEvent.click(screen.getByLabelText('2 Quellen anzeigen'));
  expect(view.container.querySelector('details')?.open).toBe(true);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  fireEvent.click(screen.getByRole('link', { name: 'Zweite Quelle' }));
  expect(invoke).toHaveBeenCalledWith('open_external', { url: 'https://example.org/two' });
});

it('opens internal links in the notebook and never exposes another account', () => {
  const target = newNote('local', 'Unsere Grundsätze');
  data.notes = [target];
  const open = vi.fn();
  window.addEventListener('notto-open-note', open);
  const view = render(<NoteMarkdown scope="local" content={noteLink(target)} />);
  fireEvent.click(screen.getByRole('link', { name: '↗ Unsere Grundsätze' }));
  expect(open.mock.calls[0][0].detail).toEqual({ id: target.id, scope: 'local' });
  expect(invoke).not.toHaveBeenCalled();
  data.notes = [{ ...target, scope: 'other' }];
  view.rerender(<NoteMarkdown scope="local" content={noteLink(target)} />);
  expect(screen.queryByRole('link')).toBeNull();
  window.removeEventListener('notto-open-note', open);
});
