// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createNottoClient } from './backend';
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }));
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('logs the desktop in, stores its token in the keyring and authenticates note synchronization', async () => {
  const user = { id: 'desktop-account', email: 'owner@example.com' };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ user, token: 'test-session-secret' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true })));
  const client = createNottoClient('https://noto-app.de');
  const login = await client.auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  expect(login.error).toBeNull();
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-Notto-Client')).toBe('desktop');
  expect(invoke).toHaveBeenCalledWith('server_session_set', {
    server: 'https://noto-app.de',
    secret: 'test-session-secret',
  });
  const result = await client.rpc('push_note', { p_id: 'test-note' });
  expect(result.error).toBeNull();
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get('Authorization')).toBe(
    'Bearer test-session-secret',
  );
  expect(fetch.mock.calls[1][0]).toBe('https://noto-app.de/api/notes/push');
  expect(JSON.stringify(localStorage)).not.toContain('test-session-secret');
});
