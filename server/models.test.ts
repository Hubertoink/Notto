import { afterEach, expect, it, vi } from 'vitest';
import { availableModels, selectableModels } from './models';
import { openai } from './openai';
import type { Database } from './database';
afterEach(() => vi.restoreAllMocks());
const list = {
  data: [
    'gpt-4.1-mini',
    'gpt-5-mini',
    'gpt-5-mini',
    'gpt-realtime',
    'gpt-image-1',
    'gpt-4o-audio-preview',
    'text-embedding-3-small',
  ].map((id) => ({ id })),
};
it('loads available analysis models, excludes incompatible types and caches concurrent reads', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(list)));
  const env = { openaiKey: 'test-only', models: [], dailyLimit: 100 };
  const result = await Promise.all([selectableModels(env), selectableModels(env)]);
  expect(result[0]).toEqual(['gpt-4.1-mini', 'gpt-5-mini']);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  expect(JSON.stringify(result)).not.toContain('test-only');
});
it('keeps explicit server restrictions and retries a failed model request', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockResolvedValue(new Response(JSON.stringify(list)));
  const env = { openaiKey: 'test-only', models: ['gpt-5-mini'], dailyLimit: 100 };
  await expect(availableModels(env)).rejects.toThrow('Berechtigung');
  expect(await selectableModels(env)).toEqual(['gpt-5-mini']);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('accepts newly discovered supported models and rejects unavailable or wrong-modality models', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify(list)))
    .mockResolvedValue(new Response(JSON.stringify({ output: [] })));
  const env = { openaiKey: 'test-only', models: [], dailyLimit: 100 };
  const db = {
    query: vi
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT document') ? { rows: [], rowCount: 0 } : { rows: [{ count: 1 }], rowCount: 1 },
      ),
  } as unknown as Database;
  await openai(db, 'test', 'responses', { model: 'gpt-5-mini', input: 'Test' }, env);
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(openai(db, 'test', 'responses', { model: 'gpt-image-1', input: 'Test' }, env)).rejects.toThrow(
    'nicht freigeschaltet',
  );
  await expect(
    openai(db, 'test', 'responses', { model: 'gpt-5-unavailable', input: 'Test' }, env),
  ).rejects.toThrow('nicht freigeschaltet');
  expect(fetch).toHaveBeenCalledTimes(2);
});
