import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app';
import { workCommandOnce } from './command-worker';
import { openai } from './openai';
import { digest } from './security';
import { newNote } from '../src/domain';
import type { Database } from './database';

vi.mock('./openai', () => ({ openai: vi.fn() }));
vi.mock('./command-browser', () => ({
  CommandBrowser: class {
    read = vi.fn(async (url: string) => ({
      pageIndex: 0,
      title: 'Icons',
      url,
      text: 'Trash: animated delete icon',
      targets: [{ id: 'capture-0', text: 'Trash: animated delete icon' }],
      links: [],
    }));
    capture = vi.fn(async () => Buffer.from([255, 216, 255, 217]));
    close = vi.fn(async () => {});
  },
}));
const pg = new PGlite();
const adapter = {
  query: async (sql: string, args?: any[]) => {
    const r = await pg.query(sql, args);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  connect: async () => ({ ...adapter, release() {} }),
} as unknown as Database;
const user = randomUUID(),
  other = randomUUID();
const note = newNote(user, 'Komponenten\nhttps://example.com/icons\n/ki Zeige ein passendes Icon');
const env = {
  models: ['gpt-4.1-mini'],
  openaiKey: 'test',
  origin: 'http://localhost:3000',
  dataDir: '.',
  secureCookies: false,
};
const settings = {
  enabled: true,
  auto: false,
  autoResearch: false,
  model: 'gpt-4.1-mini',
  excludedTags: '',
  excludedNotes: [],
};
let app: Awaited<ReturnType<typeof buildApp>>;
const headers = (owner = user) => ({ authorization: `Bearer ${owner}`, origin: env.origin });
const response = () => ({
  status: 'completed',
  output: [
    {
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({
            summary: 'Ein passendes Icon.',
            items: [
              {
                title: 'Papierkorb',
                detail: 'Animiertes Löschen',
                source: 0,
                target: 'capture-0',
                quote: 'animated delete icon',
              },
            ],
            followLinks: [],
          }),
        },
      ],
    },
  ],
});
async function start(id = randomUUID(), owner = user, revision = note.revision) {
  return app.inject({
    method: 'PUT',
    url: `/api/commands/${id}`,
    headers: headers(owner),
    payload: { noteId: note.id, revision, prompt: 'Zeige ein passendes Icon' },
  });
}
beforeAll(async () => {
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const id of [user, other]) {
    await pg.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      id,
      `${id}@test.invalid`,
      'unused',
    ]);
    await pg.query("INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [
      digest(id),
      id,
    ]);
  }
  await pg.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
    user,
    note.id,
    note.revision,
    JSON.stringify(note),
  ]);
  app = await buildApp(adapter, env);
});
beforeEach(async () => {
  await pg.exec('DELETE FROM command_images; DELETE FROM note_commands; DELETE FROM rate_limits');
  await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
    note.id,
    JSON.stringify(note),
    note.revision,
  ]);
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [user, JSON.stringify(settings)],
  );
  vi.mocked(openai).mockReset().mockResolvedValue(response());
});
afterAll(async () => {
  await app.close();
  await pg.close();
});

it('queues only on explicit start, is idempotent, and runs with automation disabled', async () => {
  expect(await workCommandOnce(adapter, env)).toBe(false);
  const id = randomUUID();
  expect((await start(id)).statusCode).toBe(200);
  expect((await start(id)).statusCode).toBe(200);
  expect((await pg.query('SELECT id FROM note_commands')).rows).toHaveLength(1);
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT * FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result.items[0].imageId).toBeTruthy();
  expect(openai).toHaveBeenCalledTimes(1);
  expect((await pg.query('SELECT document FROM notes')).rows[0]).toEqual({ document: note });
});
it('rejects other accounts, stale revisions and excluded notes', async () => {
  expect((await start(randomUUID(), other)).statusCode).toBe(404);
  expect((await start(randomUUID(), user, randomUUID())).statusCode).toBe(409);
  await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
    user,
    JSON.stringify({ ...settings, excludedNotes: [note.id] }),
  ]);
  expect((await start()).statusCode).toBe(403);
});
it('keeps screenshot bytes and results private to the owner', async () => {
  const job = (await start()).json().command;
  await workCommandOnce(adapter, env);
  const mine = await app.inject({ url: `/api/commands?noteId=${note.id}`, headers: headers() });
  const imageId = mine.json().commands[0].result.items[0].imageId;
  const url = `/api/commands/${job.id}/images/${imageId}`;
  expect((await app.inject({ url, headers: headers() })).headers['content-type']).toBe('image/jpeg');
  expect((await app.inject({ url, headers: headers(other) })).statusCode).toBe(404);
  expect((await app.inject({ url })).statusCode).toBe(401);
  expect(
    (await app.inject({ url: `/api/commands?noteId=${note.id}`, headers: headers(other) })).json().commands,
  ).toEqual([]);
});
it('cancels a pending command without sending anything to the model', async () => {
  const job = (await start()).json().command;
  await app.inject({ method: 'PUT', url: `/api/commands/${job.id}/cancel`, payload: {}, headers: headers() });
  expect(await workCommandOnce(adapter, env)).toBe(false);
  expect(openai).not.toHaveBeenCalled();
});
it('does not publish late results when cancellation arrives during the model call', async () => {
  const job = (await start()).json().command;
  vi.mocked(openai).mockImplementationOnce(async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/commands/${job.id}/cancel`,
      payload: {},
      headers: headers(),
    });
    return response();
  });
  await workCommandOnce(adapter, env);
  expect((await pg.query('SELECT status,result FROM note_commands')).rows[0]).toEqual({
    status: 'cancelled',
    result: null,
  });
  expect((await pg.query('SELECT id FROM command_images')).rows).toHaveLength(0);
});
it('stops when AI consent is revoked during a running command', async () => {
  await start();
  vi.mocked(openai).mockImplementationOnce(async () => {
    await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
      user,
      JSON.stringify({ ...settings, enabled: false }),
    ]);
    return response();
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT * FROM note_commands')).rows[0];
  expect(job.status).toBe('failed');
  expect(job.result).toBeNull();
  expect(job.error).toContain('Freigabe');
});
it('bounds concurrent jobs and rejects private input URLs', async () => {
  for (let i = 0; i < 3; i++) expect((await start()).statusCode).toBe(200);
  expect((await start()).statusCode).toBe(429);
  const result = await app.inject({
    method: 'PUT',
    url: `/api/commands/${randomUUID()}`,
    headers: headers(),
    payload: { noteId: note.id, revision: note.revision, prompt: 'Lies http://127.0.0.1' },
  });
  expect(result.statusCode).toBe(400);
});
it('keeps working from the start snapshot when the user continues writing', async () => {
  await start();
  const updated = { ...note, content: 'Weitergeschrieben', revision: randomUUID() };
  await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
    note.id,
    JSON.stringify(updated),
    updated.revision,
  ]);
  await workCommandOnce(adapter, env);
  expect((await pg.query('SELECT status FROM note_commands')).rows[0]).toEqual({ status: 'done' });
  expect(JSON.parse(vi.mocked(openai).mock.calls[0][3].input as string).notiz).toBe(note.content);
  expect((await pg.query('SELECT document FROM notes')).rows[0]).toEqual({ document: updated });
});
it('recovers an expired lease once and bounds repeated interrupted attempts', async () => {
  const job = (await start()).json().command;
  await pg.query(
    "UPDATE note_commands SET status='running',attempts=1,lease_until=now()-interval '1 minute' WHERE id=$1",
    [job.id],
  );
  await workCommandOnce(adapter, env);
  expect((await pg.query('SELECT status,attempts FROM note_commands')).rows[0]).toEqual({
    status: 'done',
    attempts: 2,
  });
  await pg.query(
    "UPDATE note_commands SET status='running',lease_until=now()-interval '1 minute' WHERE id=$1",
    [job.id],
  );
  await workCommandOnce(adapter, env);
  expect((await pg.query('SELECT status FROM note_commands')).rows[0]).toEqual({ status: 'failed' });
  expect(openai).toHaveBeenCalledTimes(1);
});
