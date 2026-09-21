// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoteMarkdown, InlineImage } from './components';
import { noteImages } from './image-layout';
import { fetchAttachment } from './cloud';
vi.mock('./cloud', () => ({ fetchAttachment: vi.fn() }));
vi.mock('./repository', () => ({ desktop: false }));
vi.mock('./state', () => ({ useNotto: () => ({ notes: [] }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('hides tag-only lines in reading mode while preserving prose and code', () => {
  render(<NoteMarkdown scope="local" content={'Text mit #bezug\n\n#cocktails #ideen\n\n```\n#code\n```'} />);
  expect(screen.queryByText('#cocktails #ideen')).toBeNull();
  expect(screen.getByText('Text mit #bezug')).toBeTruthy();
  expect(screen.getByText('#code')).toBeTruthy();
});
it('expands thumbnails on demand and exposes visual layout controls', async () => {
  vi.mocked(fetchAttachment).mockResolvedValue({ bytes: [1], mime: 'image/png' } as any);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:preview';
      static revokeObjectURL = vi.fn();
    },
  );
  const content = '![Rezept](attachments/abc.png "noto:width=50;mode=thumbnail")\n\nText';
  const view = render(<NoteMarkdown scope="local" content={content} />);
  expect(screen.queryByRole('button', { name: 'Rezept vergrößern' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bilder auffächern' }));
  expect(screen.getByRole('button', { name: 'Rezept vergrößern' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Bilder einklappen' }));
  expect(screen.queryByRole('button', { name: 'Rezept vergrößern' })).toBeNull();
  view.unmount();
  const change = vi.fn();
  render(
    <InlineImage
      scope="local"
      content={content}
      image={noteImages(content)[0]}
      onChange={change}
      disabled={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rezept bearbeiten' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Als Thumbnail' }));
  expect(change.mock.calls[0][0]).toContain('noto:width=50;mode=inline');
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
