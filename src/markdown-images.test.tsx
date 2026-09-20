// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NoteMarkdown } from './components';
import { fetchAttachment } from './cloud';
vi.mock('./cloud', () => ({ fetchAttachment: vi.fn() }));
vi.mock('./repository', () => ({ desktop: false }));
vi.mock('./state', () => ({ useNotto: () => ({ notes: [] }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps loaded image DOM and object URLs across save rerenders and text changes', async () => {
  vi.mocked(fetchAttachment).mockResolvedValue({ bytes: [1, 2], mime: 'image/png' } as any);
  const create = vi.fn().mockReturnValue('blob:test-image');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const content = '![Rezept](attachments/abc-123.png)\n\nText';
  const view = render(<NoteMarkdown scope="local" content={content} />);
  const image = await screen.findByRole('img', { name: 'Rezept' });
  view.rerender(<NoteMarkdown scope="local" content={content} />);
  view.rerender(<NoteMarkdown scope="local" content={content + ' geändert'} />);
  expect(screen.getByRole('img', { name: 'Rezept' })).toBe(image);
  expect(fetchAttachment).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:test-image');
  vi.unstubAllGlobals();
});
