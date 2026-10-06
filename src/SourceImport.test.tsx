// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourceImport } from './SourceImport';
import { serverRequest } from './backend';
const { sync, notify } = vi.hoisted(() => ({ sync: vi.fn(async () => {}), notify: vi.fn() }));
vi.mock('./backend', () => ({ serverRequest: vi.fn() }));
vi.mock('./cloud', () => ({ ownBackend: () => true, readCloudConfig: () => ({ url: 'https://noto.test' }) }));
vi.mock('./state', () => ({ useNotto: () => ({ sync, notify }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const source = { title: 'Artikel', url: 'https://example.com/article' },
  from = { scope: 'user', noteId: 'note' };
it('saves once, synchronizes, and opens the actual imported document in the same scope', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(serverRequest).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<SourceImport source={source} from={from} />);
  const button = screen.getByRole('button', { name: 'Als Dokument speichern' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(serverRequest).toHaveBeenCalledTimes(1);
  expect(serverRequest).toHaveBeenCalledWith('https://noto.test', '/documents/import', {
    noteId: 'note',
    ...source,
  });
  expect(screen.getByRole('button', { name: 'Artikel wird importiert …' }).hasAttribute('disabled')).toBe(
    true,
  );
  resolve({ document: { noteId: 'document', reused: false, needsOCR: false } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dokument öffnen' })).toBeTruthy());
  expect(sync).toHaveBeenCalledTimes(1);
  const open = vi.fn();
  window.addEventListener('notto-open-note', open, { once: true });
  fireEvent.click(screen.getByRole('button', { name: 'Dokument öffnen' }));
  expect(open.mock.calls[0][0].detail).toEqual({ id: 'document', scope: 'user' });
});
it('displays an honest failure without synchronizing or claiming a saved file and allows retry', async () => {
  vi.mocked(serverRequest).mockRejectedValueOnce(new Error('Keine frei herunterladbare PDF gefunden.'));
  render(<SourceImport source={source} from={from} />);
  fireEvent.click(screen.getByRole('button', { name: 'Als Dokument speichern' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Keine frei'));
  expect(sync).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Als Dokument speichern' }).hasAttribute('disabled')).toBe(false);
});
it('offers no server import in the local notebook', () => {
  render(<SourceImport source={source} from={{ ...from, scope: 'local' }} />);
  expect(screen.queryByRole('button')).toBeNull();
});
