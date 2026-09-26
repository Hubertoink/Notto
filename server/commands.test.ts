import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app';
import { workCommandOnce } from './command-worker';
import { openai } from './openai';
import { digest } from './security';
import { newNote, reviseNote } from '../src/domain';
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

it('supports idempotent manual retries with automation disabled', async () => {
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

it('starts saved commands exactly once, including sync retries and later edits', async () => {
  const save = (document: typeof note, base: string | null) =>
    app.inject({
      method: 'POST',
      url: '/api/notes/push',
      headers: headers(),
      payload: {
        p_id: document.id,
        p_revision: document.revision,
        p_base_revision: base,
        p_document: document,
      },
    });
  const updated = reviseNote(note, { content: note.content + '\nMehr Kontext' });
  expect((await save(updated, note.revision)).json()).toEqual({ accepted: true });
  expect((await save(updated, note.revision)).json()).toEqual({ accepted: true });
  expect((await pg.query('SELECT status,prompt FROM note_commands')).rows).toEqual([
    { status: 'pending', prompt: 'Zeige ein passendes Icon' },
  ]);
  const later = reviseNote(updated, { content: updated.content + '\nWeitergeschrieben' });
  expect((await save(later, updated.revision)).json().accepted).toBe(true);
  expect((await pg.query('SELECT id FROM note_commands')).rows).toHaveLength(1);
  const changed = reviseNote(later, {
    content: later.content.replace('ein passendes Icon', 'zwei passende Icons'),
  });
  expect((await save(changed, later.revision)).json().accepted).toBe(true);
  expect((await pg.query('SELECT id FROM note_commands')).rows).toHaveLength(2);
  const conflicting = reviseNote(note, { content: '/ki Darf nicht starten' });
  expect((await save(conflicting, note.revision)).json().accepted).toBe(false);
  expect((await pg.query('SELECT id FROM note_commands')).rows).toHaveLength(2);
});

it('saves without AI consent but records why the command cannot start', async () => {
  await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
    user,
    JSON.stringify({ ...settings, enabled: false }),
  ]);
  const updated = reviseNote(note, { content: note.content + '\nZusatz' });
  const result = await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(),
    payload: {
      p_id: note.id,
      p_revision: updated.revision,
      p_base_revision: note.revision,
      p_document: updated,
    },
  });
  expect(result.json().accepted).toBe(true);
  const job: any = (await pg.query('SELECT status,error FROM note_commands')).rows[0];
  expect(job.status).toBe('failed');
  expect(job.error).toContain('freigeben');
  expect(await workCommandOnce(adapter, env)).toBe(false);
  expect(openai).not.toHaveBeenCalled();
});

it('really searches for reviews, verifies recency and preserves clickable citations without screenshots', async () => {
  await start();
  await pg.query(
    "UPDATE note_commands SET prompt='Suche Rezensionen zu den letzten drei Veröffentlichungen',note_content='Mouhanad Khorchide'",
  );
  const text = 'Eine belegte Rezension. [1]';
  const searched = {
    status: 'completed',
    output: [
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [
              {
                type: 'url_citation',
                start_index: text.indexOf('[1]'),
                end_index: text.length,
                title: 'Rezension',
                url: 'https://example.com/review',
              },
            ],
          },
        ],
      },
    ],
  };
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) =>
    body.tools
      ? searched
      : {
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify(
                    (body.text as any)?.format?.name === 'research_result'
                      ? {
                          summary: 'Eine Rezension belegt',
                          text: '[Rezension](https://example.com/review)',
                          partial: true,
                        }
                      : { queries: ['Mouhanad Khorchide Rezension'] },
                  ),
                },
              ],
            },
          ],
        },
  );
  await workCommandOnce(adapter, env);
  expect(openai).toHaveBeenCalledTimes(5);
  for (const call of vi.mocked(openai).mock.calls.filter((call) => call[3].tools)) {
    expect(call[3]).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required' });
    expect(call[3].input).toBe('Mouhanad Khorchide Rezension');
  }
  const job: any = (await pg.query('SELECT result FROM note_commands')).rows[0];
  expect(job.result.research).toContain('[Rezension](https://example.com/review)');
  expect(job.result.searched).toBe(true);
  expect((await pg.query('SELECT id FROM command_images')).rows).toHaveLength(0);
});
