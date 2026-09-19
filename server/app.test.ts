import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { workOnce } from './worker';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app';
import type { Database } from './database';
import { digest } from './security';
import { newNote, reviseNote } from '../src/domain';
const pg = new PGlite();
const origin = 'http://localhost:3000';
let app: Awaited<ReturnType<typeof buildApp>>, dir: string;
let alice: string, bob: string;
let aToken: string, bToken: string;
const adapter = {
  query: (text: string, args?: unknown[]) =>
    pg.query(text, args).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length })),
  connect: async () => ({ ...adapter, release: () => {} }),
} as unknown as Database;
const headers = (secret?: string) => ({
  origin,
  'x-notto-client': 'desktop',
  ...(secret ? { authorization: `Bearer ${secret}` } : {}),
});
beforeAll(async () => {
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  dir = await mkdtemp(join(tmpdir(), 'notto-server-'));
  await pg.query('INSERT INTO invitations(hash,email) VALUES($1,$2),($3,$4)', [
    digest('alice-invite'),
    'alice@example.com',
    digest('bob-invite'),
    'bob@example.com',
  ]);
  app = await buildApp(adapter, {
    origin,
    dataDir: dir,
    secureCookies: false,
    models: ['gpt-4.1-mini'],
    dailyLimit: 10,
  });
  const a = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: headers(),
    payload: { email: 'alice@example.com', password: 'long-test-password', invite: 'alice-invite' },
  });
  expect(a.statusCode).toBe(200);
  aToken = a.json().token;
  alice = a.json().user.id;
  const b = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: headers(),
    payload: { email: 'bob@example.com', password: 'another-test-password', invite: 'bob-invite' },
  });
  expect(b.statusCode).toBe(200);
  bToken = b.json().token;
  bob = b.json().user.id;
}, 30000);
afterAll(async () => {
  await app?.close();
  await pg.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it('runs consented server jobs with quoted evidence without rewriting originals', async () => {
  await pg.exec('DELETE FROM jobs');
  const note = newNote(alice, 'Steam Families auf vier PCs einrichten');
  await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(aToken),
    payload: { p_id: note.id, p_revision: note.revision, p_base_revision: null, p_document: note },
  });
  const environment = { openaiKey: 'test-only', models: ['gpt-4.1-mini'], dailyLimit: 10 };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    suggestions: [
                      { kind: 'task', title: 'Steam einrichten', detail: 'Vier PCs', quote: note.content },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
  try {
    await workOnce(adapter, environment);
    expect(fetch).not.toHaveBeenCalled();
    await app.inject({
      method: 'PUT',
      url: '/api/ai/settings',
      headers: headers(aToken),
      payload: {
        enabled: true,
        auto: true,
        autoResearch: false,
        model: 'gpt-4.1-mini',
        excludedTags: 'privat',
        excludedNotes: [],
        dailyLimit: 10,
      },
    });
    await workOnce(adapter, environment);
    expect(fetch).toHaveBeenCalledOnce();
    const knowledge = (await app.inject({ url: '/api/knowledge', headers: headers(aToken) })).json().data;
    expect(knowledge.some((r: any) => r.document.noteId === note.id && r.document.kind === 'analysis')).toBe(
      true,
    );
    const original = (await app.inject({ url: '/api/notes', headers: headers(aToken) }))
      .json()
      .data.find((r: any) => r.document.id === note.id).document;
    expect(original).toEqual(note);
  } finally {
    fetch.mockRestore();
  }
});
it('requires invitations and authenticates without exposing a browser session token', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: headers(),
        payload: { email: 'third@example.com', password: 'long-test-password' },
      })
    ).statusCode,
  ).toBe(403);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { email: 'alice@example.com', password: 'long-test-password' },
  });
  expect(login.statusCode).toBe(200);
  expect(login.json().token).toBeUndefined();
  expect(login.headers['set-cookie']).toContain('HttpOnly');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { email: 'alice@example.com', password: 'wrong-test-password' },
      })
    ).statusCode,
  ).toBe(401);
});
it('isolates users and preserves winning notes on stale compare-and-swap writes', async () => {
  const note = newNote(alice, 'Original');
  const push = (n: typeof note, base: string | null) =>
    app.inject({
      method: 'POST',
      url: '/api/notes/push',
      headers: headers(aToken),
      payload: { p_id: n.id, p_revision: n.revision, p_base_revision: base, p_document: n },
    });
  expect((await push(note, null)).json().accepted).toBe(true);
  expect((await push(note, null)).json().accepted).toBe(true);
  const next = reviseNote(note, { content: 'Updated' });
  expect((await push(next, note.revision)).json().accepted).toBe(true);
  expect((await push(reviseNote(note, { content: 'Stale' }), note.revision)).json()).toMatchObject({
    accepted: false,
    document: { content: 'Updated' },
  });
  expect((await app.inject({ url: '/api/notes', headers: headers(bToken) })).json().data).toHaveLength(0);
  expect((await app.inject({ url: '/api/notes' })).statusCode).toBe(401);
});
it('protects attachments and prevents overwriting immutable files', async () => {
  const id = '10000000-0000-4000-8000-000000000001.pdf',
    payload = {
      name: 'Test.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.7 original').toString('base64'),
    };
  expect(
    (await app.inject({ method: 'PUT', url: `/api/attachments/${id}`, headers: headers(aToken), payload }))
      .statusCode,
  ).toBe(200);
  expect((await app.inject({ url: `/api/attachments/${id}`, headers: headers(bToken) })).statusCode).toBe(
    404,
  );
  expect((await app.inject({ url: `/api/attachments/${id}`, headers: headers(aToken) })).body).toBe(
    '%PDF-1.7 original',
  );
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/attachments/${id}`,
        headers: headers(aToken),
        payload: { ...payload, base64: Buffer.from('%PDF-changed').toString('base64') },
      })
    ).statusCode,
  ).toBe(409);
});
it('rejects foreign knowledge and cross-origin writes and revokes sessions on logout', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/knowledge',
        headers: headers(aToken),
        payload: [
          {
            id: crypto.randomUUID(),
            scope: bob,
            kind: 'decision',
            noteId: crypto.randomUUID(),
            revision: crypto.randomUUID(),
            at: new Date().toISOString(),
            data: {},
          },
        ],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { ...headers(bToken), origin: 'https://evil.example' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(bToken), payload: {} }))
      .statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/api/notes', headers: headers(bToken) })).statusCode).toBe(401);
});
