// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoteMarkdown, InlineImage, ImageLightbox } from './components';
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
it('makes reading-mode tasks interactive only when a save handler is present', () => {
  const change = vi.fn();
  const view = render(
    <NoteMarkdown scope="local" content={'- [ ] Toilettenpapier\n- [x] Milch'} onTaskChange={change} />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toilettenpapier erledigen' }));
  expect(change).toHaveBeenCalledWith(0, true);
  expect((screen.getByRole('checkbox', { name: 'Milch wieder öffnen' }) as HTMLInputElement).disabled).toBe(
    false,
  );
  view.rerender(<NoteMarkdown scope="local" content="- [ ] Nur lesen" />);
  expect((screen.getByRole('checkbox', { name: 'Nur lesen erledigen' }) as HTMLInputElement).disabled).toBe(
    true,
  );
});
it('removes only the selected image reference, blocks native dragging and does not resize thumbnails', async () => {
  vi.mocked(fetchAttachment).mockResolvedValue({ bytes: [1], mime: 'image/png' } as any);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:image';
      static revokeObjectURL = vi.fn();
    },
  );
  const content =
    'Titel\n![Erstes](attachments/abc.png "noto:width=50;mode=thumbnail")\n![Zweites](attachments/def.png)\nEnde';
  const change = vi.fn();
  render(
    <InlineImage
      content={content}
      image={noteImages(content)[0]}
      scope="local"
      onChange={change}
      disabled={false}
    />,
  );
  const img = await screen.findByRole('img');
  expect(img.getAttribute('draggable')).toBe('false');
  expect(fireEvent.dragStart(img)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Erstes bearbeiten' }));
  expect(screen.queryByRole('button', { name: 'Bildgröße ändern' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bild aus Notiz entfernen' }));
  expect(change).toHaveBeenLastCalledWith('Titel\n\n![Zweites](attachments/def.png)\nEnde');
});
it('groups adjacent reading images without merging images across prose', () => {
  const { container } = render(
    <NoteMarkdown
      scope="local"
      content={
        '![A](attachments/abc.png)\n\n![B](attachments/def.png)\n\nZwischentext\n\n![C](attachments/aaa.png)'
      }
    />,
  );
  const rows = container.querySelectorAll('.reading-image-row');
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelectorAll('.note-image-button')).toHaveLength(2);
  expect(screen.getByText('Zwischentext')).toBeTruthy();
});
it('resizes through the handle relative to the row without duplicating the image', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const content = '![Foto](attachments/abc.png "noto:width=50;mode=inline")';
  const change = vi.fn();
  const { container } = render(
    <div>
      <InlineImage
        content={content}
        image={noteImages(content)[0]}
        scope="local"
        onChange={change}
        disabled={false}
      />
    </div>,
  );
  Object.defineProperty(container.firstElementChild, 'clientWidth', { value: 500 });
  fireEvent.click(screen.getByRole('button', { name: 'Foto bearbeiten' }));
  const handle = screen.getByRole('button', { name: 'Bildgröße ändern' });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { clientX: 200 });
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { clientX: 200 });
  expect(noteImages(change.mock.calls[0][0])).toHaveLength(1);
  expect(noteImages(change.mock.calls[0][0])[0].width).toBe(70);
});
it('opens a frameless image dialog, downloads the original and closes on Escape', async () => {
  vi.mocked(fetchAttachment).mockResolvedValue({ bytes: [1], mime: 'image/png', name: 'Rezept.png' } as any);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:original';
      static revokeObjectURL = vi.fn();
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('Rezept.png');
    expect(this.href).toBe('blob:original');
  });
  const close = vi.fn();
  render(<ImageLightbox src="attachments/abc.png" alt="Rezept" scope="local" onClose={close} />);
  await screen.findByRole('img', { name: 'Rezept' });
  expect(screen.queryByRole('heading')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Herunterladen' }));
  expect(click).toHaveBeenCalledOnce();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
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
