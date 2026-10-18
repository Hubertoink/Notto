// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageSettings } from './StorageSettings';
import { serverRequest } from './backend';
const state = vi.hoisted(() => ({ user: { id: 'alice' } as { id: string } | null }));
vi.mock('./state', () => ({ useNotto: () => state }));
vi.mock('./cloud', () => ({
  ownBackend: () => true,
  readCloudConfig: () => ({ url: 'https://noto.example' }),
}));
vi.mock('./backend', () => ({ serverRequest: vi.fn() }));
vi.mock('./components', () => ({
  Action: ({ label, onClick, isDisabled }: { label: string; onClick: () => void; isDisabled?: boolean }) => (
    <button disabled={isDisabled} onClick={onClick}>
      {label}
    </button>
  ),
  readableDate: (value: string) => value,
}));
const report = {
  measuredAt: '2026-10-18T10:00:00.000Z',
  totalBytes: 4096,
  trashCount: 4,
  historyBytes: 512,
  categories: [
    { key: 'attachments', label: 'Bilder und Dokumente', bytes: 3072, count: 4 },
    { key: 'document-cache', label: 'Dokument-Kontextcache', bytes: 1024, count: 1 },
  ],
  largestAttachments: [{ id: 'a.pdf', name: 'Dokument.pdf', bytes: 3072 }],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.user = { id: 'alice' };
});
it('shows server categories, distinguishes hosting and confirms cache cleanup', async () => {
  vi.mocked(serverRequest).mockResolvedValue(report);
  render(<StorageSettings />);
  expect(await screen.findByLabelText('Kontodaten: 4 KiB')).toBeTruthy();
  expect(screen.getByText(/Dokument.pdf/)).toBeTruthy();
  expect(screen.getByText(/nicht der Mittwald-Projektverbrauchs?/)).toBeTruthy();
  expect(screen.getByText('Aufschlüsselung & Versionshistorie').closest('details')?.open).toBe(false);
  expect(screen.getByText('Größte Anhänge (1)').closest('details')?.open).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Server-Caches bereinigen' }));
  expect(serverRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(serverRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Server-Caches bereinigen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Caches jetzt löschen' }));
  await waitFor(() =>
    expect(serverRequest).toHaveBeenCalledWith('https://noto.example', '/storage/cache', { confirm: true }),
  );
  expect(await screen.findByText(/Server-Caches gelöscht/)).toBeTruthy();
});
it('shows errors instead of reporting a successful cleanup', async () => {
  vi.mocked(serverRequest).mockResolvedValueOnce(report).mockRejectedValueOnce(new Error('Server offline'));
  render(<StorageSettings />);
  await screen.findByLabelText('Kontodaten: 4 KiB');
  fireEvent.click(screen.getByRole('button', { name: 'Server-Caches bereinigen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Caches jetzt löschen' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Server offline');
  expect(screen.queryByText(/Server-Caches gelöscht/)).toBeNull();
});
it('keeps hosting separate and collapses technical details by default', async () => {
  vi.mocked(serverRequest).mockResolvedValue({
    ...report,
    hosting: {
      measuredAt: '2026-10-18T10:00:00.000Z',
      registryBytes: 1024 ** 3,
      attachmentBytes: 3072,
      databaseVolumeBytes: 4096,
      databaseBytes: 2048,
      registryTags: 2,
    },
  });
  render(<StorageSettings />);
  expect(await screen.findByRole('heading', { name: 'Hosting-Speicher' })).toBeTruthy();
  expect(screen.getByText('1 GiB')).toBeTruthy();
  expect(screen.getByLabelText('Kontodaten: 4 KiB')).toBeTruthy();
  expect(screen.getByText('Hosting-Details & Aufbewahrung').closest('details')?.open).toBe(false);
  expect(screen.getByText(/Kein Livewert/)).toBeTruthy();
});
it('does not request account storage for a local notebook', () => {
  state.user = null;
  render(<StorageSettings />);
  expect(serverRequest).not.toHaveBeenCalled();
  expect(screen.getByText(/mit einem Noto-Serverkonto anmelden/)).toBeTruthy();
});
