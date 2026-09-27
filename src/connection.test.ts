// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { connectionOffline, ConnectionError, networkFetch } from './connection';
afterEach(() => vi.restoreAllMocks());
it('recognizes transport failure despite browser online and recovers on the next response', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(networkFetch('/api/notes')).rejects.toBeInstanceOf(ConnectionError);
  expect(connectionOffline()).toBe(true);
  fetch.mockResolvedValue(new Response('{}', { status: 401 }));
  expect((await networkFetch('/api/notes')).status).toBe(401);
  expect(connectionOffline()).toBe(false);
});
it('avoids requests offline and aborts an in-flight request when connectivity disappears', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(networkFetch('/api/notes')).rejects.toBeInstanceOf(ConnectionError);
  expect(fetch).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  fetch.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  const pending = networkFetch('/api/notes');
  window.dispatchEvent(new Event('offline'));
  await expect(pending).rejects.toBeInstanceOf(ConnectionError);
});
