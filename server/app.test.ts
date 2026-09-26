import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { workOnce } from './worker';
import { findServerRelations } from './note-relations';
import { openai } from './openai';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app';
import type { Database } from './database';
import { digest } from './security';
import { newNote, reviseNote } from '../src/domain';
import { notebookTools } from '../src/agent-tools';
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
it('keeps completed analyses completed after a model switch but schedules newly enabled research', async () => {
  const note = newNote(alice, 'Music Assistant auf dem Heimserver prüfen');
  await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(aToken),
    payload: { p_id: note.id, p_revision: note.revision, p_base_revision: null, p_document: note },
  });
  const settings = {
    enabled: true,
    auto: true,
    autoResearch: false,
    model: 'gpt-4.1-mini',
    excludedTags: '',
    excludedNotes: [],
  };
  const save = (payload: typeof settings) =>
    app.inject({ method: 'PUT', url: '/api/ai/settings', headers: headers(aToken), payload });
  await save(settings);
  await pg.query("UPDATE jobs SET status='done' WHERE note_id=$1 AND kind='analysis'", [note.id]);
  expect((await save({ ...settings, model: 'gpt-5-mini' })).statusCode).toBe(200);
  expect(
    (
      await pg.query<{ status: string }>("SELECT status FROM jobs WHERE note_id=$1 AND kind='analysis'", [
        note.id,
      ])
    ).rows[0].status,
  ).toBe('done');
  await save({ ...settings, autoResearch: true });
  expect(
    (
      await pg.query<{ status: string }>("SELECT status FROM jobs WHERE note_id=$1 AND kind='analysis'", [
        note.id,
      ])
    ).rows[0].status,
  ).toBe('pending');
  await pg.query('DELETE FROM ai_settings WHERE user_id=$1', [alice]);
  await pg.query('DELETE FROM jobs WHERE note_id=$1', [note.id]);
});
it('checks theory links in two stages without sending private notes and rejects revoked targets', async () => {
  const source = newNote(alice, 'Die Jugendhauskonzeption braucht ein Leitbild.');
  const target = newNote(alice, 'Leitbildentwicklung verbindet Werte und Handlungsziele.');
  const privateNote = newNote(alice, 'GEHEIMER-INHALT #privat');
  const settings = {
    enabled: true,
    auto: true,
    autoResearch: false,
    model: 'gpt-4.1-mini',
    excludedNotes: [],
    excludedTags: 'privat',
  };
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [alice, JSON.stringify(settings)],
  );
  for (const note of [source, target, privateNote])
    await app.inject({
      method: 'POST',
      url: '/api/notes/push',
      headers: headers(aToken),
      payload: { p_id: note.id, p_revision: note.revision, p_base_revision: null, p_document: note },
    });
  let revoke = false;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.input).not.toContain('GEHEIMER-INHALT');
    const input = JSON.parse(body.input);
    if (input.notes && revoke)
      await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
        alice,
        JSON.stringify({ ...settings, excludedNotes: [target.id] }),
      ]);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(
                  input.candidates
                    ? { ids: [target.id] }
                    : {
                        suggestions: [
                          {
                            sourceId: source.id,
                            targetId: target.id,
                            relation: 'theory',
                            reason: 'Theoretische Grundlage für die Konzeption.',
                            sourceQuote: source.content,
                            targetQuote: target.content,
                            anchor: 'Leitbild',
                          },
                        ],
                      },
                ),
              },
            ],
          },
        ],
      }),
    );
  });
  try {
    const env = { openaiKey: 'test-only', models: ['gpt-4.1-mini'] };
    await findServerRelations(adapter, env, alice, source, settings);
    let rows = (
      await pg.query(
        "SELECT document FROM knowledge WHERE user_id=$1 AND document->>'noteId'=$2 AND document->>'kind'='note-relations'",
        [alice, source.id],
      )
    ).rows as any[];
    expect(rows[0].document.data.suggestions).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await pg.query(
      "DELETE FROM knowledge WHERE user_id=$1 AND document->>'noteId'=$2 AND document->>'kind'='note-relations'",
      [alice, source.id],
    );
    revoke = true;
    await findServerRelations(adapter, env, alice, source, settings);
    rows = (
      await pg.query(
        "SELECT document FROM knowledge WHERE user_id=$1 AND document->>'noteId'=$2 AND document->>'kind'='note-relations'",
        [alice, source.id],
      )
    ).rows as any[];
    expect(rows[0].document.data.suggestions).toEqual([]);
  } finally {
    fetch.mockRestore();
    await pg.query('DELETE FROM ai_settings WHERE user_id=$1', [alice]);
  }
});
it('ignores legacy daily quotas and preserves notebook tools', async () => {
  await pg.query('DELETE FROM rate_limits WHERE key=$1', [`ai:${alice}`]);
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [
      alice,
      JSON.stringify({
        enabled: true,
        auto: true,
        autoResearch: false,
        model: 'gpt-4.1-mini',
        excludedNotes: [],
        excludedTags: '',
        dailyLimit: 1,
      }),
    ],
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ output: [] })));
  try {
    const environment = { openaiKey: 'test-only', models: ['gpt-4.1-mini'], dailyLimit: 100 };
    await openai(
      adapter,
      alice,
      'responses',
      { model: 'gpt-4.1-mini', input: 'Atlas', tools: notebookTools },
      environment,
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.tools).toEqual(notebookTools);
    expect(body.include).toContain('reasoning.encrypted_content');
    await expect(
      openai(adapter, alice, 'responses', { model: 'gpt-4.1-mini', input: 'Noch einmal' }, environment),
    ).resolves.toEqual({ output: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
    await pg.query('DELETE FROM rate_limits WHERE key=$1', [`ai:${alice}`]);
  }
});
it('discards a worker result when a note is excluded during the request', async () => {
  await pg.exec('DELETE FROM jobs');
  const note = newNote(alice, 'Atlas: vier PCs einrichten');
  const settings = {
    enabled: true,
    auto: true,
    autoResearch: false,
    model: 'gpt-4.1-mini',
    excludedNotes: [] as string[],
    excludedTags: '',
    dailyLimit: 100,
  };
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [alice, JSON.stringify(settings)],
  );
  await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(aToken),
    payload: { p_id: note.id, p_revision: note.revision, p_base_revision: null, p_document: note },
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
      alice,
      JSON.stringify({ ...settings, excludedNotes: [note.id] }),
    ]);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  suggestions: [
                    { kind: 'task', title: 'PCs einrichten', detail: 'Vier', quote: note.content },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    );
  });
  try {
    await workOnce(adapter, { openaiKey: 'test-only', models: ['gpt-4.1-mini'], dailyLimit: 100 });
    expect(fetch).toHaveBeenCalledOnce();
    const saved = await pg.query(
      "SELECT document FROM knowledge WHERE user_id=$1 AND document->>'noteId'=$2 AND document->>'kind'='analysis'",
      [alice, note.id],
    );
    expect(saved.rows).toHaveLength(0);
  } finally {
    fetch.mockRestore();
    await pg.query('DELETE FROM ai_settings WHERE user_id=$1', [alice]);
  }
});
it('resumes jobs deferred by the removed daily quota without waiting until tomorrow', async () => {
  await pg.exec('DELETE FROM jobs');
  const note = newNote(alice, 'Atlas: vier PCs einrichten');
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [
      alice,
      JSON.stringify({
        enabled: true,
        auto: true,
        autoResearch: false,
        model: 'gpt-4.1-mini',
        excludedNotes: [],
        excludedTags: '',
        dailyLimit: 1,
      }),
    ],
  );
  await pg.query(
    'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET count=1',
    [`ai:${alice}`, Math.floor(Date.now() / 86400000)],
  );
  await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(aToken),
    payload: { p_id: note.id, p_revision: note.revision, p_base_revision: null, p_document: note },
  });
  await pg.query(
    "UPDATE jobs SET available_at=now()+interval '1 day',error='Tageslimit erreicht. Fortsetzung am nächsten UTC-Tag.' WHERE note_id=$1",
    [note.id],
  );
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify({ suggestions: [] }) }] }],
      }),
    ),
  );
  try {
    await workOnce(adapter, { openaiKey: 'test-only', models: ['gpt-4.1-mini'], dailyLimit: 100 });
    const job = (
      await pg.query("SELECT status,attempts,available_at FROM jobs WHERE note_id=$1 AND kind='analysis'", [
        note.id,
      ])
    ).rows[0] as any;
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    fetch.mockRestore();
    await pg.query('DELETE FROM ai_settings WHERE user_id=$1', [alice]);
    await pg.query('DELETE FROM rate_limits WHERE key=$1', [`ai:${alice}`]);
  }
});
it('allows desktop attachment upload preflight including PUT', async () => {
  for (const origin of ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']) {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/attachments/test.pdf',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type,x-notto-client',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(
      String(response.headers['access-control-allow-methods'])
        .split(',')
        .map((method) => method.trim()),
    ).toContain('PUT');
  }
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
it('reports the deployed package version in the health endpoint', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true, version });
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
  const memory = {
    id: crypto.randomUUID(),
    scope: alice,
    noteId: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'memory',
    data: {
      key: 'work-style',
      category: 'instruction',
      text: 'Berücksichtige vorhandene Geräte.',
      status: 'active',
      sources: [],
    },
  };
  expect(
    (await app.inject({ method: 'POST', url: '/api/knowledge', headers: headers(aToken), payload: [memory] }))
      .statusCode,
  ).toBe(200);
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).instructions).toContain(memory.data.text);
    const knowledge = (await app.inject({ url: '/api/knowledge', headers: headers(aToken) })).json().data;
    expect(knowledge.some((r: any) => r.document.noteId === note.id && r.document.kind === 'analysis')).toBe(
      true,
    );
    const original = (await app.inject({ url: '/api/notes', headers: headers(aToken) }))
      .json()
      .data.find((r: any) => r.document.id === note.id).document;
    expect(original).toEqual(note);
    fetch.mockImplementation(async () => new Response(JSON.stringify({ output: [] })));
    await openai(adapter, bob, 'responses', { model: 'gpt-4.1-mini', input: 'Hallo' }, environment);
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body)).instructions).not.toContain(
      memory.data.text,
    );
    const forgotten = {
      ...memory,
      id: crypto.randomUUID(),
      at: new Date(Date.now() + 1000).toISOString(),
      data: { ...memory.data, status: 'forgotten', text: '' },
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/knowledge',
          headers: headers(aToken),
          payload: [forgotten],
        })
      ).statusCode,
    ).toBe(200);
    await openai(adapter, alice, 'responses', { model: 'gpt-4.1-mini', input: 'Hallo' }, environment);
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body)).instructions).not.toContain(
      memory.data.text,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/knowledge',
          headers: headers(aToken),
          payload: [{ ...memory, id: crypto.randomUUID(), data: { ...memory.data, category: 'invalid' } }],
        })
      ).statusCode,
    ).toBe(400);
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
it('syncs manual tasks as separate knowledge records', async () => {
  const record = {
    id: crypto.randomUUID(),
    scope: alice,
    noteId: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'manual-task',
    data: { title: 'Eigene Aufgabe', done: false },
  };
  const result = await app.inject({
    method: 'POST',
    url: '/api/knowledge',
    headers: headers(aToken),
    payload: [record],
  });
  expect(result.statusCode).toBe(200);
  const read = await app.inject({ url: '/api/knowledge', headers: headers(aToken) });
  expect(read.json().data.some((r: any) => r.document.id === record.id)).toBe(true);
  const other = await app.inject({ url: '/api/knowledge', headers: headers(bToken) });
  expect(other.json().data.some((r: any) => r.document.id === record.id)).toBe(false);
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

it('syncs empty collections and rejects invalid collection names', async () => {
  const record = {
    id: crypto.randomUUID(),
    noteId: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    scope: alice,
    at: new Date().toISOString(),
    kind: 'collection',
    data: { name: 'Jugendhaus' },
  };
  const saved = await app.inject({
    method: 'POST',
    url: '/api/knowledge',
    headers: headers(aToken),
    payload: [record],
  });
  expect(saved.statusCode).toBe(200);
  const list = await app.inject({ method: 'GET', url: '/api/knowledge', headers: headers(aToken) });
  expect(list.json().data.some((r: any) => r.document.id === record.id)).toBe(true);
  const bad = await app.inject({
    method: 'POST',
    url: '/api/knowledge',
    headers: headers(aToken),
    payload: [{ ...record, id: crypto.randomUUID(), data: { name: ' ' } }],
  });
  expect(bad.statusCode).toBe(400);
});
