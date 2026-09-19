// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Sources, NoteMarkdown } from './components';
import { uniqueSources } from './knowledge-policy';
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('./repository', () => ({ desktop: true }));
vi.mock('./state', () => ({ useNotto: () => ({ notify: vi.fn() }) }));
afterEach(() => {
  cleanup();
  invoke.mockClear();
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
