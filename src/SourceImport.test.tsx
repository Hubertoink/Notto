// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourceImport } from './SourceImport';
import { serverRequest } from './backend';
const { sync, notify } = vi.hoisted(() => ({ sync: vi.fn(async () => {}), notify: vi.fn() }));
vi.mock('./backend', () => ({ serverRequest: vi.fn() }));
vi.mock('./cloud', () => ({ ownBackend: () => true, readCloudConfig: () => ({ url: 'https://noto.test' }) }));
vi.mock('./state', () => ({ useNotto: () => ({ sync, notify }) }));
beforeEach(() => {
  vi.mocked(serverRequest)
    .mockReset()
    .mockImplementation(async (_base, path) => {
      if (path === '/documents/check')
        return { availability: { status: 'available', message: 'PDF vorhanden.' } };
      return { document: { noteId: 'document', reused: false, needsOCR: false } };
    });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const source = { title: 'Artikel', url: 'https://example.com/article' },
  from = { scope: 'user', noteId: 'note' };
it('saves once, synchronizes, and opens the actual imported document in the same scope', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(serverRequest).mockImplementation(async (_base, path) =>
    path === '/documents/check'
      ? { availability: { status: 'available', message: 'PDF vorhanden.' } }
      : new Promise((done) => {
          resolve = done;
        }),
  );
  render(<SourceImport source={source} from={from} />);
  const button = await screen.findByRole('button', { name: 'Als Dokument speichern' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(vi.mocked(serverRequest).mock.calls.filter((call) => call[1] === '/documents/import')).toHaveLength(
    1,
  );
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
  vi.mocked(serverRequest).mockImplementation(async (_base, path) => {
    if (path === '/documents/check') return { availability: { status: 'available', message: '' } };
    throw new Error('Keine frei herunterladbare PDF gefunden.');
  });
  render(<SourceImport source={source} from={from} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Als Dokument speichern' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Keine frei'));
  expect(sync).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Als Dokument speichern' }).hasAttribute('disabled')).toBe(false);
});
it('offers no server import in the local notebook', () => {
  render(<SourceImport source={source} from={{ ...from, scope: 'local' }} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(serverRequest).not.toHaveBeenCalled();
});
it('checks first and never attempts an import for an unavailable PDF', async () => {
  vi.mocked(serverRequest).mockResolvedValue({
    availability: { status: 'unavailable', message: 'Keine freie PDF.' },
  });
  render(<SourceImport source={source} from={from} />);
  expect(screen.getByRole('button', { name: 'PDF wird geprüft …' }).hasAttribute('disabled')).toBe(true);
  await screen.findByText('Kein frei zugängliches PDF');
  expect(screen.queryByRole('button', { name: 'Als Dokument speichern' })).toBeNull();
  expect(serverRequest).toHaveBeenCalledTimes(1);
  expect(sync).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  vi.mocked(serverRequest).mockResolvedValue({ availability: { status: 'available', message: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quelle erneut prüfen' }));
  await screen.findByRole('button', { name: 'Als Dokument speichern' });
  expect(serverRequest).toHaveBeenLastCalledWith('https://noto.test', '/documents/check', {
    noteId: 'note',
    url: source.url,
    refresh: true,
  });
});
it('leaves a transient check failure retryable without presenting it as an absent PDF', async () => {
  vi.mocked(serverRequest).mockRejectedValue(new Error('Offline'));
  render(<SourceImport source={source} from={from} />);
  await screen.findByText('PDF-Verfügbarkeit derzeit nicht prüfbar');
  expect(screen.queryByText('Kein frei zugängliches PDF')).toBeNull();
  expect(screen.getByRole('button', { name: 'Quelle erneut prüfen' }).hasAttribute('disabled')).toBe(false);
  expect(sync).not.toHaveBeenCalled();
});
it('handles a PDF becoming unavailable between checking and importing as a normal source status', async () => {
  vi.mocked(serverRequest).mockImplementation(async (_base, path) => {
    if (path === '/documents/check') return { availability: { status: 'available', message: '' } };
    throw Object.assign(new Error('Quelle nicht mehr frei zugänglich.'), { statusCode: '422' });
  });
  render(<SourceImport source={source} from={from} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Als Dokument speichern' }));
  await screen.findByText('Kein frei zugängliches PDF');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(sync).not.toHaveBeenCalled();
});
it('keeps temporary import failures distinct from missing documents', async () => {
  vi.mocked(serverRequest).mockImplementation(async (_base, path) => {
    if (path === '/documents/check') return { availability: { status: 'available', message: '' } };
    throw Object.assign(new Error('Quelle derzeit nicht erreichbar.'), { statusCode: '424' });
  });
  render(<SourceImport source={source} from={from} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Als Dokument speichern' }));
  await screen.findByText('PDF-Verfügbarkeit derzeit nicht prüfbar');
  expect(screen.queryByText('Kein frei zugängliches PDF')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not check sources hidden in a collapsed disclosure until they become visible', async () => {
  let observe!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof observe) {
        observe = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  try {
    render(
      <details>
        <summary>Quellen</summary>
        <SourceImport source={source} from={from} />
      </details>,
    );
    expect(serverRequest).not.toHaveBeenCalled();
    observe([{ isIntersecting: false }]);
    expect(serverRequest).not.toHaveBeenCalled();
    observe([{ isIntersecting: true }]);
    await screen.findByRole('button', { name: 'Als Dokument speichern', hidden: true });
    expect(serverRequest).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
