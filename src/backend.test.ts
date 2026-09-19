// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createNottoClient } from './backend';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('uses HTTP-only cookie sessions and preserves an offline account without caching a token', async () => {
  const user = { id: 'account-id', email: 'owner@example.com' };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));
  const client = createNottoClient('https://noto-app.de');
  expect(
    (await client.auth.signInWithPassword({ email: user.email, password: 'long-test-password' })).data.user,
  ).toEqual(user);
  expect(fetch.mock.calls[0][1]?.credentials).toBe('include');
  expect(localStorage.getItem('notto-user:https://noto-app.de')).toBe(JSON.stringify(user));
  fetch.mockRejectedValue(new TypeError('offline'));
  expect((await client.auth.getSession()).data.session?.user).toEqual(user);
  expect((await client.auth.getUser()).error).not.toBeNull();
});
