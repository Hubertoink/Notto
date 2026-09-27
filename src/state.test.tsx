// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NottoProvider, useNotto } from './state';
import { ConnectionError } from './connection';
const mocks = vi.hoisted(() => ({ sync: vi.fn(), list: vi.fn().mockResolvedValue([]) }));
vi.mock('./cloud', () => ({
  syncNotes: mocks.sync,
  cloud: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'owner' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }),
}));
vi.mock('./repository', () => ({ desktop: false, repo: { list: mocks.list } }));
function Status() {
  const state = useNotto();
  return <p>{state.syncState}</p>;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.sync.mockReset();
});
it('starts offline with the local account and resumes synchronization on reconnect', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  mocks.sync.mockResolvedValue(0);
  render(
    <NottoProvider>
      <Status />
    </NottoProvider>,
  );
  await screen.findByText('offline');
  expect(mocks.sync).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByText('synced');
  expect(mocks.sync).toHaveBeenCalledWith('owner');
});
it('retries transport failures and preserves distinct authentication errors', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  mocks.sync
    .mockRejectedValueOnce(new ConnectionError())
    .mockResolvedValueOnce(0)
    .mockRejectedValueOnce(new Error('Bitte erneut anmelden.'));
  render(
    <NottoProvider>
      <Status />
    </NottoProvider>,
  );
  await screen.findByText('offline');
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByText('synced');
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(screen.getByText('error')).toBeTruthy());
});
