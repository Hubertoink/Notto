import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newNote, reviseNote, type Note } from '../src/domain';
import { resumeAttachmentAnalyses } from './attachment-jobs';
import { workOnce } from './worker';
import type { Database } from './database';

const pg = new PGlite();
const db = {
  query: (text: string, args?: unknown[]) =>
    pg.query(text, args).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length })),
} as unknown as Database;
const user = crypto.randomUUID(),
  id = `${crypto.randomUUID()}.txt`;
const settings = {
  enabled: true,
  auto: true,
  autoResearch: false,
  excludedTags: '',
  excludedNotes: [],
  model: 'gpt-4.1-mini',
};
let dir: string, path: string;
beforeAll(async () => {
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await pg.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    'fixture@example.test',
    'unused',
  ]);
  dir = await mkdtemp(join(tmpdir(), 'noto-worker-files-'));
  path = join(dir, user, id);
  await mkdir(join(dir, user));
}, 20000);
beforeEach(async () => {
  await pg.exec('DELETE FROM jobs; DELETE FROM knowledge; DELETE FROM notes; DELETE FROM ai_settings;');
  await rm(path, { force: true });
  await pg.query('INSERT INTO ai_settings(user_id,document) VALUES($1,$2)', [user, JSON.stringify(settings)]);
});
afterAll(async () => {
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});
async function failed(
  note: Note,
  error = `ENOENT: no such file or directory, open '${path}'`,
  revision = note.revision,
) {
  const jobId = crypto.randomUUID();
  await pg.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
    user,
    note.id,
    note.revision,
    JSON.stringify(note),
  ]);
  await pg.query(
    "INSERT INTO jobs(id,user_id,note_id,revision,kind,status,attempts,error) VALUES($1,$2,$3,$4,'analysis','failed',3,$5)",
    [jobId, user, note.id, revision, error],
  );
  return jobId;
}
const note = () => newNote(user, `Ownership im Jugendhaus. [Artikel](attachments/${id})`);

it('analyzes attachments above the old 60,000 character limit using original passages near the end', async () => {
  const n = note(),
    jobId = await failed(n, 'Notiz zu lang: maximal 60.000 Zeichen für eine Analyse.');
  // The migration resumes precisely the jobs which failed at the removed limit.
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const original =
    'Allgemeiner Hintergrund. '.repeat(6000) +
    '\nOwnership im Jugendhaus erfordert klare Entscheidungsspielräume.';
  await writeFile(path, original);
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
                      {
                        kind: 'topic',
                        title: 'Ownership',
                        detail: 'Entscheidungsspielräume klären.',
                        quote: 'Ownership im Jugendhaus erfordert klare Entscheidungsspielräume.',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );
  try {
    await workOnce(db, { dataDir: dir, openaiKey: 'test-only', models: ['gpt-4.1-mini'] });
    expect((await pg.query('SELECT status,error FROM jobs WHERE id=$1', [jobId])).rows[0]).toMatchObject({
      status: 'done',
      error: null,
    });
    const input = JSON.parse(String(fetch.mock.calls[0][1]?.body)).input;
    expect(input.length).toBeLessThan(60000);
    expect(input).toContain('Ownership im Jugendhaus erfordert klare Entscheidungsspielräume.');
    const row: any = (await pg.query("SELECT document FROM knowledge WHERE document->>'kind'='analysis'"))
      .rows[0];
    expect(row.document.data.context.mode).toBe('selected');
    expect(
      (await pg.query('SELECT document FROM document_context_cache WHERE user_id=$1', [user])).rows,
    ).toHaveLength(1);
  } finally {
    fetch.mockRestore();
  }
});

it('recovers an exhausted missing attachment job and completes analysis with actual file context', async () => {
  const n = note(),
    jobId = await failed(n);
  await pg.query("UPDATE jobs SET status='pending',attempts=2 WHERE id=$1", [jobId]);
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
                    {
                      kind: 'topic',
                      title: 'Ownership',
                      detail: '',
                      quote: 'Mitarbeitende erhalten echte Entscheidungsspielräume.',
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    ),
  );
  try {
    const env = { dataDir: dir, openaiKey: 'test-only', models: ['gpt-4.1-mini'], dailyLimit: 100 };
    await workOnce(db, env);
    expect((await pg.query('SELECT status,attempts FROM jobs WHERE id=$1', [jobId])).rows[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await resumeAttachmentAnalyses(db, dir)).toBe(0);
    const originalText = 'Mitarbeitende\n\n erhalten echte Entscheidungsspielräume.';
    await writeFile(path, originalText);
    expect(await resumeAttachmentAnalyses(db, dir)).toBe(1);
    expect(await resumeAttachmentAnalyses(db, dir)).toBe(0);
    // The analysis predates the relation job inserted by the worker.
    await workOnce(db, env);
    expect(
      (await pg.query('SELECT status,error,attempts FROM jobs WHERE id=$1', [jobId])).rows[0],
    ).toMatchObject({ status: 'done', error: null, attempts: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).input).toContain(
      JSON.stringify(originalText).slice(1, -1),
    );
    const analyses = (await pg.query("SELECT document FROM knowledge WHERE document->>'kind'='analysis'"))
      .rows as any[];
    expect(analyses).toHaveLength(1);
    expect(analyses[0].document.data.suggestions[0].quote).toBe(originalText);
  } finally {
    fetch.mockRestore();
  }
});

it('does not retry unrelated errors, obsolete text or deleted notes', async () => {
  await writeFile(path, 'Quelle');
  await failed(note(), 'OpenAI request failed.');
  await failed(note(), "ENOENT: no such file or directory, open '/other/font.ttf'");
  const original = note(),
    changed = reviseNote(original, { content: original.content + ' Neue Fachfrage.' });
  await failed(changed, undefined, original.revision);
  await failed({ ...note(), deleted: true });
  expect(await resumeAttachmentAnalyses(db, dir)).toBe(0);
});

it('respects automatic analysis opt-out and excluded notes and tags', async () => {
  await writeFile(path, 'Quelle');
  const n = note();
  await failed(n);
  for (const override of [
    { auto: false },
    { enabled: false },
    { excludedNotes: [n.id] },
    { excludedTags: 'privat' },
  ]) {
    await pg.query('UPDATE ai_settings SET document=$1 WHERE user_id=$2', [
      JSON.stringify({ ...settings, ...override }),
      user,
    ]);
    if ('excludedTags' in override)
      await pg.query('UPDATE notes SET document=$1 WHERE id=$2', [
        JSON.stringify({ ...n, content: n.content + ' #privat' }),
        n.id,
      ]);
    expect(await resumeAttachmentAnalyses(db, dir)).toBe(0);
  }
});

it('requires all current readable attachments in the same user directory', async () => {
  await writeFile(path, 'Quelle');
  const otherId = `${crypto.randomUUID()}.pdf`;
  await failed(newNote(user, `${note().content} [Weitere Quelle](attachments/${otherId})`));
  await failed(note(), `ENOENT: no such file or directory, open '${join(dir, crypto.randomUUID(), id)}'`);
  expect(await resumeAttachmentAnalyses(db, dir)).toBe(0);
});

it('recovers the applicable analysis after a link-only revision', async () => {
  await writeFile(path, 'Quelle');
  const original = note(),
    linked = reviseNote(original, {
      content: original.content.replace('Ownership', `[Ownership](notes/${crypto.randomUUID()})`),
    });
  await failed(linked, undefined, original.revision);
  expect(await resumeAttachmentAnalyses(db, dir)).toBe(1);
});
