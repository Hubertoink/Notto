import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Operator script is deliberately plain Node.js.
import { deployedDigests, offlineCollection, registryRequest } from './deploy-mittwald.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('retries temporary registry gateway failures on actual image requests', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(new Response());
  vi.stubGlobal('fetch', fetch);
  const result = registryRequest('https://registry.example/v2/notto/blobs/sha256:test', { method: 'HEAD' });
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].method).toBe('HEAD');
});

it('does not hide missing blobs or permanent registry failures', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  expect((await registryRequest('https://registry.example/blob', {})).status).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('stops retrying a persistently unavailable registry', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const result = registryRequest('https://registry.example/blob', {});
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(12);
});

const digest = (n: number) => `sha256:${String(n).repeat(64)}`;
it('protects all deployed and pending app/worker digests and rejects uncertain deployments', () => {
  const containers = ['app', 'worker'].map((serviceName) => ({
    serviceName,
    status: 'running',
    requiresRecreate: false,
    deployedState: { imageDigest: digest(1) },
    pendingState: { imageDigest: digest(2) },
  }));
  expect(deployedDigests(containers)).toEqual([digest(1), digest(2)]);
  expect(() => deployedDigests(containers.slice(0, 1))).toThrow();
  expect(() => deployedDigests([{ ...containers[0], requiresRecreate: true }, containers[1]])).toThrow();
  expect(() => deployedDigests([{ ...containers[0], pendingState: {} }, containers[1]])).toThrow();
});
it.each(['stop', 'create', 'wait', 'success'])(
  'restarts registry after %s and removes the collector first',
  async (failure) => {
    const events: string[] = [];
    const operations = Object.fromEntries(
      ['stop', 'create', 'wait', 'remove', 'start'].map((name) => [
        name,
        vi.fn(async () => {
          events.push(name);
          if (name === failure) throw new Error(`${name} failed`);
          return name === 'create' ? 'collector-id' : undefined;
        }),
      ]),
    );
    if (failure === 'success') await offlineCollection(operations);
    else await expect(offlineCollection(operations)).rejects.toThrow(`${failure} failed`);
    expect(events.at(-1)).toBe('start');
    expect(events.indexOf('remove')).toBeLessThan(events.indexOf('start'));
  },
);
it('keeps registry offline if the collector cannot be safely removed', async () => {
  const start = vi.fn();
  await expect(
    offlineCollection({
      stop: vi.fn(),
      create: vi.fn(),
      wait: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error('Collector removal failed')),
      start,
    }),
  ).rejects.toThrow('Collector removal failed');
  expect(start).not.toHaveBeenCalled();
});
