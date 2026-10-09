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
import { fetchYoutubeTranscript } from './youtube-fetch';

vi.mock('./openai', () => ({ openai: vi.fn() }));
vi.mock('./youtube-fetch', () => ({ fetchYoutubeTranscript: vi.fn() }));
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
function verificationResponse(
  body: Record<string, unknown>,
  count: number | null = null,
  items: string[] = [],
) {
  const name = (body.text as any)?.format?.name;
  const value =
    name === 'research_plan'
      ? { objective: 'Originalauftrag erfüllen', requestedCount: count, criteria: [], excludedExamples: [] }
      : name === 'research_review'
        ? { fulfilled: true, deliveredItems: items, issues: [], corrections: [], criterionChecks: [] }
        : undefined;
  return value
    ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }
    : undefined;
}
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
  await pg.exec('DELETE FROM youtube_transcript_cache');
  vi.mocked(fetchYoutubeTranscript).mockReset();
  await pg.exec('DELETE FROM command_images; DELETE FROM note_commands; DELETE FROM rate_limits');
  await pg.query('DELETE FROM notes WHERE id<>$1', [note.id]);
  await pg.exec('DELETE FROM knowledge');
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

it.each(['success', 'with-pdf', 'unavailable', 'web-off', 'revoked', 'changed', 'ungrounded'])(
  'uses real transcript evidence and time links for a video command: %s',
  async (mode) => {
    const current = reviseNote(note, {
      content:
        'Lernbüro\nhttps://youtu.be/qp0HIF3SfI4\nhttps://www.youtube.com/watch?v=qp0HIF3SfI4&t=9' +
        (mode === 'with-pdf'
          ? '\n[Quality Youth Work](attachments/e5906e8f-1025-48f2-983c-0ad9a0426ec7.pdf)\nhttps://example.com/unrelated'
          : ''),
    });
    await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
      note.id,
      JSON.stringify(current),
      current.revision,
    ]);
    if (mode === 'web-off')
      await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
        user,
        JSON.stringify({ ...settings, commandWeb: false }),
      ]);
    vi.mocked(fetchYoutubeTranscript).mockImplementation(async () => {
      if (mode === 'unavailable') throw new Error('Keine Untertitel verfügbar.');
      if (mode === 'revoked')
        await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
          user,
          JSON.stringify({ ...settings, commandWeb: false }),
        ]);
      if (mode === 'changed') {
        const changed = reviseNote(current, { content: 'Anderes Video https://youtu.be/dQw4w9WgXcQ' });
        await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
          note.id,
          JSON.stringify(changed),
          changed.revision,
        ]);
      }
      return {
        title: 'Lernbüro',
        automatic: true,
        segments: [
          { text: 'Willkommen.', offset: 0, duration: 3, lang: 'de' },
          { text: 'Lernende prüfen ihren Fortschritt.', offset: 83.5, duration: 4, lang: 'de' },
          ...(mode === 'with-pdf'
            ? Array.from({ length: 590 }, (_, index) => ({
                text: `Lernbüroabschnitt ${index} mit weiteren Inhalten.`,
                offset: 90 + index * 4,
                duration: 4,
                lang: 'de',
              }))
            : []),
        ],
      };
    });
    vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
      const input = JSON.parse(body.input as string);
      expect((body.text as any).format.name).toBe('note_command');
      if (mode === 'with-pdf') {
        expect(input.sources).toHaveLength(1);
        expect(input.sources[0].text).toContain('Lernbüroabschnitt 589');
        expect(input.sources[0].transcript.partial).toBe(false);
      }
      if (mode !== 'web-off') {
        expect(input.sources[0].text).toContain('[01:23] Lernende prüfen ihren Fortschritt.');
        expect(input.sources[0].transcript).toMatchObject({ language: 'de', automatic: true });
      }
      return {
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  summary: 'Zusammenfassung',
                  followLinks: [],
                  items: [
                    {
                      title: 'Fortschritt',
                      kind: 'fact',
                      detail: 'Lernende kontrollieren ihren Fortschritt.',
                      source: 0,
                      target: null,
                      quote:
                        mode === 'ungrounded'
                          ? 'Das steht nicht im Video.'
                          : 'Lernende prüfen ihren Fortschritt.',
                    },
                  ],
                }),
              },
            ],
          },
        ],
      };
    });
    const id = randomUUID();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/commands/${id}`,
          headers: headers(),
          payload: {
            noteId: note.id,
            revision: current.revision,
            prompt:
              mode === 'with-pdf'
                ? 'Fasse die Kernaussagen des verlinkten Videos zum selbstregulierten Lernen zusammen. Welche Ansätze lassen sich auf die offene Jugendarbeit übertragen? Trenne Aussagen aus dem Video von eigenen Vorschlägen und belege die Videoaussagen mit Zeitmarken.'
                : 'Fasse dieses Video zusammen.',
          },
        })
      ).statusCode,
    ).toBe(200);
    await workCommandOnce(adapter, env);
    const job: any = (await pg.query('SELECT status,result,error FROM note_commands WHERE id=$1', [id]))
      .rows[0];
    if (['revoked', 'changed'].includes(mode)) {
      expect(job.status).toBe('failed');
      expect(openai).not.toHaveBeenCalled();
    } else {
      expect(job.status).toBe('done');
      if (mode === 'success' || mode === 'with-pdf') {
        expect(job.result.items[0]).toMatchObject({
          url: 'https://www.youtube.com/watch?v=qp0HIF3SfI4&t=83s',
          transcriptCitation: {
            quote: 'Lernende prüfen ihren Fortschritt.',
            start: 83.5,
            language: 'de',
            automatic: true,
          },
        });
        expect(job.result.transcripts).toHaveLength(1);
        expect(job.result.searched).toBe(false);
        expect(job.result.warnings).toEqual([]);
        expect(job.result.items[0].kind).toBe('fact');
      } else if (mode === 'unavailable') {
        expect(job.result.items).toEqual([]);
        expect(job.result.partial).toBe(true);
        expect(job.result.warnings.join(' ')).toContain('Keine Untertitel');
        expect(openai).not.toHaveBeenCalled();
      } else if (mode === 'ungrounded') expect(job.result.items).toEqual([]);
    }
    expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(mode === 'web-off' ? 0 : 1);
  },
);

it.each([
  { policy: undefined, commandWeb: undefined, expected: true },
  { policy: 'inherit' as const, commandWeb: true, expected: true },
  { policy: 'off' as const, commandWeb: true, expected: false },
  { policy: 'inherit' as const, commandWeb: false, expected: false },
])(
  'uses the notebook default for legacy notes and snapshots explicit opt-outs: %j',
  async ({ policy, commandWeb, expected }) => {
    const current = reviseNote(note, { aiContext: { mode: 'note', web: false, webPolicy: policy } });
    await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
      note.id,
      JSON.stringify(current),
      current.revision,
    ]);
    await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
      user,
      JSON.stringify({ ...settings, commandWeb }),
    ]);
    expect((await start(randomUUID(), user, current.revision)).statusCode).toBe(200);
    const job: any = (await pg.query('SELECT context FROM note_commands')).rows[0];
    expect(job.context).toMatchObject({ mode: 'note', web: expected });
  },
);

it('applies the same inherited web setting when saving an inline command', async () => {
  const current = reviseNote(note, {
    content: 'Ownership als Führungsprinzip\n/ki gibt es hierzu Führungskonzepte?',
    aiContext: { mode: 'note', web: false },
  });
  const saved = await app.inject({
    method: 'POST',
    url: '/api/notes/push',
    headers: headers(),
    payload: {
      p_id: note.id,
      p_revision: current.revision,
      p_base_revision: note.revision,
      p_document: current,
    },
  });
  expect(saved.json()).toEqual({ accepted: true });
  expect((await pg.query('SELECT prompt,context FROM note_commands')).rows[0]).toMatchObject({
    prompt: 'gibt es hierzu Führungskonzepte?',
    context: { web: true },
  });
});

it('honors a global web opt-out made after a command was queued', async () => {
  await start();
  await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
    user,
    JSON.stringify({ ...settings, commandWeb: false }),
  ]);
  const localResponse = response();
  const answer = JSON.parse(localResponse.output[0].content[0].text);
  answer.items[0].target = null;
  localResponse.output[0].content[0].text = JSON.stringify(answer);
  vi.mocked(openai).mockResolvedValue(localResponse);
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result).toMatchObject({ webEnabled: false, searched: false, sources: [] });
  expect(openai).toHaveBeenCalledTimes(1);
  expect(vi.mocked(openai).mock.calls[0][3].tools).toBeUndefined();
  expect(
    JSON.parse(vi.mocked(openai).mock.calls[0][3].input as string).sources.every(
      (source: any) => !source.url,
    ),
  ).toBe(true);
});

it('researches an open-ended question from a legacy note instead of restricting the answer to that note', async () => {
  const prompt = 'gibt es hierzu Führungskonzepte?';
  const current = reviseNote(note, {
    content: 'Ownership als Führungsprinzip\nVerantwortung für Projekte und Prozesse im Jugendhaus.',
    aiContext: { mode: 'note', web: false },
  });
  await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
    note.id,
    JSON.stringify(current),
    current.revision,
  ]);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/commands/${randomUUID()}`,
        headers: headers(),
        payload: { noteId: current.id, revision: current.revision, prompt },
      })
    ).statusCode,
  ).toBe(200);
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
    expect(JSON.parse(body.input as string).auftrag).toBe(prompt);
    const verification = verificationResponse(body, null, ['Belegter Führungsansatz']);
    if (verification) return verification;
    if (!body.tools)
      return {
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ queries: ['Ownership Führung wissenschaftliche Theorie'] }),
              },
            ],
          },
        ],
      };
    expect(body.tool_choice).toBe('required');
    const text = 'Ein belegter Führungsansatz. [1]';
    return {
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed' },
        {
          content: [
            {
              type: 'output_text',
              text,
              annotations: [
                {
                  type: 'url_citation',
                  start_index: text.indexOf('[1]'),
                  end_index: text.length,
                  title: 'Fachquelle',
                  url: 'https://example.com/leadership',
                },
              ],
            },
          ],
        },
      ],
    };
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result).toMatchObject({ webEnabled: true, searched: true, partial: false });
  expect(job.result.research).toContain('[Fachquelle](https://example.com/leadership)');
  expect(vi.mocked(openai).mock.calls.filter((call) => call[3].tools)).toHaveLength(1);
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
  const cleaned: any = (await pg.query('SELECT document FROM notes')).rows[0].document;
  expect(cleaned.content).toBe('Komponenten\nhttps://example.com/icons\n');
  expect(cleaned.history[0]).toEqual(note.history[0]);
  expect(cleaned.history).toHaveLength(2);
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
it('cleans a completed prompt without losing edits or a changed instruction', async () => {
  await start();
  const edited = reviseNote(note, { content: note.content + '\nNeue Gedanken\n/ki Ein anderer Auftrag' });
  vi.mocked(openai).mockImplementationOnce(async () => {
    await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
      note.id,
      JSON.stringify(edited),
      edited.revision,
    ]);
    return response();
  });
  await workCommandOnce(adapter, env);
  const cleaned: any = (await pg.query('SELECT document FROM notes WHERE id=$1', [note.id])).rows[0].document;
  expect(cleaned.content).toBe(
    'Komponenten\nhttps://example.com/icons\nNeue Gedanken\n/ki Ein anderer Auftrag',
  );
  expect(cleaned.history.some((version: any) => version.content === edited.content)).toBe(true);
});
it('retains a failed prompt so it can be corrected and retried', async () => {
  await start();
  vi.mocked(openai).mockRejectedValueOnce(new Error('Offline'));
  await workCommandOnce(adapter, env);
  expect((await pg.query('SELECT document FROM notes WHERE id=$1', [note.id])).rows[0].document).toEqual(
    note,
  );
});
it('removes legacy completed instructions on save and accepts a retried push', async () => {
  await start();
  await pg.query("UPDATE note_commands SET status='done',result=$1", [
    JSON.stringify({ items: [{ title: 'Ergebnis' }] }),
  ]);
  const edited = reviseNote(note, { content: note.content + '\nNeue Gedanken' });
  const payload = {
    p_id: note.id,
    p_revision: edited.revision,
    p_base_revision: note.revision,
    p_document: edited,
  };
  for (let retry = 0; retry < 2; retry++)
    expect(
      (await app.inject({ method: 'POST', url: '/api/notes/push', headers: headers(), payload })).json()
        .accepted,
    ).toBe(true);
  const cleaned: any = (await pg.query('SELECT document FROM notes WHERE id=$1', [note.id])).rows[0].document;
  expect(cleaned.content).toBe('Komponenten\nhttps://example.com/icons\nNeue Gedanken');
  expect((await pg.query('SELECT id FROM note_commands')).rows).toHaveLength(1);
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

it('researches reading recommendations from the Brooks note without requiring supplied articles', async () => {
  await start();
  const prompt = 'Ich brauche zum Einstieg Artikel und Lesempfehlungen zu seinen Theorien.';
  const content =
    'Essentielle Komplexität\nFrederick P. Brooks Gedanken zur Essentiellen Komplexität scheinen interessant.';
  await pg.query('UPDATE note_commands SET prompt=$1,note_content=$2', [prompt, content]);
  const text = 'Zum Einstieg: No Silver Bullet. [1]';
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
    const verification = verificationResponse(body);
    if (verification) return verification;
    if (!body.tools) {
      expect(JSON.parse(body.input as string)).toMatchObject({ auftrag: prompt, notiz: content });
      return {
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  queries: ['Frederick P. Brooks essential complexity No Silver Bullet reading'],
                }),
              },
            ],
          },
        ],
      };
    }
    expect(body).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required' });
    return {
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
                  title: 'No Silver Bullet',
                  url: 'https://example.com/brooks',
                },
              ],
            },
          ],
        },
      ],
    };
  });
  await workCommandOnce(adapter, env);
  expect(openai).toHaveBeenCalledTimes(4);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result.searched).toBe(true);
  expect(job.result.research).toContain('[No Silver Bullet](https://example.com/brooks)');
  expect(job.result.sources).toContainEqual({ title: 'No Silver Bullet', url: 'https://example.com/brooks' });
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
  vi.mocked(openai).mockImplementation(
    async (_db, _user, _endpoint, body) =>
      verificationResponse(body, 3, ['Buch eins']) ??
      (body.tools
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
          }),
  );
  await workCommandOnce(adapter, env);
  expect(openai).toHaveBeenCalledTimes(13);
  for (const call of vi.mocked(openai).mock.calls.filter((call) => call[3].tools)) {
    expect(call[3]).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required' });
    expect(JSON.parse(call[3].input as string)).toMatchObject({
      auftrag: 'Suche Rezensionen zu den letzten drei Veröffentlichungen',
      notiz: 'Mouhanad Khorchide',
      suchanfrage: 'Mouhanad Khorchide Rezension',
    });
  }
  const job: any = (await pg.query('SELECT result FROM note_commands')).rows[0];
  expect(job.result.research).toContain('[Rezension](https://example.com/review)');
  expect(job.result.searched).toBe(true);
  expect(job.result.partial).toBe(true);
  expect((await pg.query('SELECT id FROM command_images')).rows).toHaveLength(0);
});

it('researches the complete games request and preserves every criterion beyond the search query', async () => {
  await start();
  const prompt =
    'gib mir fünf Gemeinschaftsspiele, die auch einfach zu erlernen sind, für jugendliche ab 12 Jahre geeignet sind. Sich einfach in einen spielerischen Abend integrieren lassen und kommunikativ sind';
  const content = 'Mögliche Neuanschaffungen: Bluff, Beasty Bar und Challengers';
  await pg.query('UPDATE note_commands SET prompt=$1,note_content=$2', [prompt, content]);
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
    expect(JSON.parse(body.input as string)).toMatchObject({ auftrag: prompt, notiz: content });
    const verification = verificationResponse(body, 5, ['A', 'B', 'C', 'D', 'E']);
    if (verification) return verification;
    if (!body.tools)
      return {
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ queries: ['kommunikative Gemeinschaftsspiele'] }),
              },
            ],
          },
        ],
      };
    expect(JSON.parse(body.input as string).suchanfrage).toBe('kommunikative Gemeinschaftsspiele');
    const text = 'Fünf passende Spiele mit Begründung. [1]';
    return {
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed' },
        {
          content: [
            {
              type: 'output_text',
              text,
              annotations: [
                {
                  type: 'url_citation',
                  start_index: text.indexOf('[1]'),
                  end_index: text.length,
                  title: 'Spielregeln',
                  url: 'https://example.com/games',
                },
              ],
            },
          ],
        },
      ],
    };
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result.searched).toBe(true);
  expect(job.result.research).toContain('[Spielregeln](https://example.com/games)');
  expect(openai).toHaveBeenCalledTimes(4);
});

it('marks an unavailable search as failed instead of completing an empty task', async () => {
  await start();
  await pg.query("UPDATE note_commands SET prompt='Gib mir fünf Gemeinschaftsspiele',note_content='Bluff'");
  vi.mocked(openai).mockRejectedValueOnce(new Error('Websuche nicht verfügbar'));
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result,error FROM note_commands')).rows[0];
  expect(job.status).toBe('failed');
  expect(job.result).toBeNull();
  expect(job.error).toContain('Websuche nicht verfügbar');
  expect((await pg.query('SELECT document FROM notes WHERE id=$1', [note.id])).rows[0].document).toEqual(
    note,
  );
});

async function startDocumentCommand() {
  const attachment = `${randomUUID()}.pdf`;
  const live = reviseNote(note, {
    content: `Konzeption Jugendhaus\n[Konzeption](attachments/${attachment})\n/ki Fasse die Konzeption zusammen`,
    aiContext: { mode: 'note', webPolicy: 'off' },
  });
  await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
    note.id,
    JSON.stringify(live),
    live.revision,
  ]);
  const extraction = {
    id: randomUUID(),
    scope: user,
    noteId: note.id,
    revision: live.revision,
    kind: 'extraction',
    at: new Date().toISOString(),
    data: {
      id: attachment,
      pages: [
        {
          noteId: note.id,
          revision: live.revision,
          attachment,
          page: 7,
          text: 'Jugendliche bestimmen das Programm gemeinsam.',
        },
      ],
    },
  };
  await pg.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3)', [
    user,
    extraction.id,
    JSON.stringify(extraction),
  ]);
  const started = await app.inject({
    method: 'PUT',
    url: `/api/commands/${randomUUID()}`,
    headers: headers(),
    payload: { noteId: note.id, revision: live.revision, prompt: 'Fasse die Konzeption zusammen' },
  });
  expect(started.statusCode).toBe(200);
  return { live, attachment };
}
function documentResponse(quote = 'Jugendliche bestimmen das Programm gemeinsam.') {
  return {
    status: 'completed',
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              summary: 'Beteiligung ist vorgesehen.',
              items: [
                {
                  title: 'Beteiligung',
                  detail: 'Jugendliche bestimmen das Programm gemeinsam.',
                  kind: 'fact',
                  source: 1,
                  target: null,
                  quote,
                },
              ],
              followLinks: [],
            }),
          },
        ],
      },
    ],
  };
}
it('supplies attached PDF text to a command and persists a clickable page citation without web search', async () => {
  const { attachment } = await startDocumentCommand();
  vi.mocked(openai).mockResolvedValue(documentResponse());
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  const input = JSON.parse(vi.mocked(openai).mock.calls[0][3].input as string);
  expect(input.sources[1]).toMatchObject({
    text: 'Jugendliche bestimmen das Programm gemeinsam.',
    evidence: { attachment, page: 7 },
  });
  expect(job.result.items[0].citation).toMatchObject({
    noteId: note.id,
    attachment,
    page: 7,
    quote: 'Jugendliche bestimmen das Programm gemeinsam.',
  });
  expect(openai).toHaveBeenCalledTimes(1);
  expect(job.result.searched).toBe(false);
  expect(job.result.webEnabled).toBe(false);
});
it('reads a long document in sections before synthesizing a summary with original page citations', async () => {
  const { attachment, live } = await startDocumentCommand();
  const extraction: any = (
    await pg.query("SELECT id,document FROM knowledge WHERE document->>'kind'='extraction'")
  ).rows[0];
  extraction.document.data.pages = Array.from({ length: 5 }, (_, index) => ({
    noteId: note.id,
    revision: live.revision,
    attachment,
    page: index + 1,
    text:
      `Abschnitt ${index + 1}: Jugendliche entscheiden gemeinsam. ` +
      'Pädagogischer Hintergrund. '.repeat(1100),
  }));
  await pg.query('UPDATE knowledge SET document=$2 WHERE id=$1', [
    extraction.id,
    JSON.stringify(extraction.document),
  ]);
  const readPages = new Set<number>();
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
    const input = JSON.parse(body.input as string);
    const name = (body.text as any).format.name;
    let result: unknown;
    if (name === 'document_section') {
      for (const source of input.sources) if (source.page) readPages.add(source.page);
      const source = input.sources.find((source: any) => source.attachment);
      result = {
        findings: [
          { source: source.index, quote: source.text.slice(0, 90), detail: 'Beteiligung wird beschrieben.' },
        ],
        insufficient: false,
      };
    } else {
      expect(readPages.size).toBe(5);
      expect(input.documentCoverage).toBe('sectionwise');
      expect(input.readingNotes.length).toBeGreaterThan(1);
      result = {
        summary: 'Die Abschnitte behandeln Beteiligung.',
        items: [
          {
            kind: 'fact',
            title: 'Beteiligung',
            detail: 'Jugendliche entscheiden gemeinsam.',
            source: 0,
            target: null,
            quote: input.sources[0].text.slice(0, 90),
          },
        ],
        followLinks: [],
      };
    }
    return {
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    };
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,error,result FROM note_commands')).rows[0];
  expect(job, job.error).toMatchObject({ status: 'done', error: null });
  expect(job.result.context.mode).toBe('sectionwise');
  expect(job.result.items[0].citation).toMatchObject({ attachment, page: 1 });
  expect(job.result.context.sources.filter((s: any) => s.attachment)).toHaveLength(5);
  expect(job.result.searched).toBe(false);
});
it('discards invented PDF quotes instead of retaining an unsupported summary', async () => {
  await startDocumentCommand();
  vi.mocked(openai).mockResolvedValue(documentResponse('Nicht im Dokument enthalten.'));
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.result.items).toEqual([]);
  expect(job.result.summary).not.toBe('Beteiligung ist vorgesehen.');
  expect(job.result.warnings.join(' ')).toContain('Quellenbeleg fehlt');
});

it('marks results with unreadable attached pages as partial and keeps the instruction retryable', async () => {
  const { live, attachment } = await startDocumentCommand();
  const extraction: any = (
    await pg.query("SELECT id,document FROM knowledge WHERE document->>'noteId'=$1", [note.id])
  ).rows[0];
  extraction.document.data.pages.push({
    noteId: note.id,
    revision: live.revision,
    attachment,
    page: 8,
    text: '[Kein Text erkannt. OCR erforderlich.]',
  });
  await pg.query('UPDATE knowledge SET document=$2 WHERE id=$1', [
    extraction.id,
    JSON.stringify(extraction.document),
  ]);
  vi.mocked(openai).mockResolvedValue(documentResponse());
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT stage,result FROM note_commands')).rows[0];
  expect(job.stage).toBe('Teilergebnis');
  expect(job.result.partial).toBe(true);
  expect(job.result.warnings.join(' ')).toContain('Seite 8');
  expect(
    (await pg.query('SELECT document FROM notes WHERE id=$1', [note.id])).rows[0].document.content,
  ).toContain('/ki Fasse die Konzeption zusammen');
});
it('rejects document results if the user revokes source permission during generation', async () => {
  await startDocumentCommand();
  vi.mocked(openai).mockImplementation(async () => {
    await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
      user,
      JSON.stringify({ ...settings, excludedNotes: [note.id] }),
    ]);
    return documentResponse();
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result,error FROM note_commands')).rows[0];
  expect(job.status).toBe('failed');
  expect(job.result).toBeNull();
  expect(job.error).toContain('Freigabe');
});

async function startLibraryCommand() {
  const attachment = `${randomUUID()}.docx`;
  const library = {
    ...newNote(user, `Konzeption Jugendhaus\n[Konzeption](attachments/${attachment})`),
    collections: ['Jugendhaus'],
    document: {
      attachmentId: attachment,
      name: 'Konzeption.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      version: 2,
    },
  };
  const current = reviseNote(note, {
    aiContext: { mode: 'selected', sourceIds: [library.id], webPolicy: 'off' },
  });
  await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
    note.id,
    JSON.stringify(current),
    current.revision,
  ]);
  await pg.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
    user,
    library.id,
    library.revision,
    JSON.stringify(library),
  ]);
  const extraction = {
    id: randomUUID(),
    scope: user,
    noteId: library.id,
    revision: library.revision,
    kind: 'extraction',
    at: new Date().toISOString(),
    data: {
      id: attachment,
      pages: [
        {
          noteId: library.id,
          revision: library.revision,
          attachment,
          text: 'Der Jugendrat entscheidet gemeinsam über das Programm.',
        },
      ],
    },
  };
  await pg.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3)', [
    user,
    extraction.id,
    JSON.stringify(extraction),
  ]);
  expect((await start(randomUUID(), user, current.revision)).statusCode).toBe(200);
  await pg.query("UPDATE note_commands SET prompt='Mache einen Vorschlag auf Basis der Konzeption'");
  return { library, attachment };
}
it('uses a standalone library document from another note and labels new proposals', async () => {
  const { library, attachment } = await startLibraryCommand();
  vi.mocked(openai).mockImplementation(async (_db, _user, _endpoint, body) => {
    const input = JSON.parse(body.input as string);
    const source = input.sources.findIndex((source: any) => source.evidence?.attachment === attachment);
    expect(source).toBeGreaterThanOrEqual(0);
    return {
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                summary: 'Vorschlag für Beteiligung.',
                items: [
                  {
                    title: 'Monatliche Jugendratssitzung',
                    detail: 'Vorschlag: Plant einen regelmäßigen Termin.',
                    kind: 'proposal',
                    source,
                    target: null,
                    quote: 'Der Jugendrat entscheidet gemeinsam über das Programm.',
                  },
                ],
                followLinks: [],
              }),
            },
          ],
        },
      ],
    };
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result FROM note_commands')).rows[0];
  expect(job.status).toBe('done');
  expect(job.result.items[0]).toMatchObject({
    kind: 'proposal',
    citation: { noteId: library.id, attachment, title: 'Konzeption Jugendhaus · Version 2' },
  });
  expect(openai).toHaveBeenCalledTimes(1);
});
it('rejects an answer when a separately selected document changes during generation', async () => {
  const { library } = await startLibraryCommand();
  vi.mocked(openai).mockImplementation(async () => {
    const changed = reviseNote(library, {
      content: `Geänderte Konzeption\n[Konzeption](attachments/${library.document.attachmentId})`,
    });
    await pg.query('UPDATE notes SET document=$2,revision=$3 WHERE id=$1', [
      library.id,
      JSON.stringify(changed),
      changed.revision,
    ]);
    return {
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                summary: 'Überholt',
                items: [
                  {
                    title: 'Jugendrat',
                    detail: 'Beteiligung',
                    kind: 'fact',
                    source: 1,
                    target: null,
                    quote: 'Der Jugendrat entscheidet gemeinsam über das Programm.',
                  },
                ],
                followLinks: [],
              }),
            },
          ],
        },
      ],
    };
  });
  await workCommandOnce(adapter, env);
  const job: any = (await pg.query('SELECT status,result,error FROM note_commands')).rows[0];
  expect(job.status).toBe('failed');
  expect(job.result).toBeNull();
  expect(job.error).toContain('Quelle wurde geändert');
});
