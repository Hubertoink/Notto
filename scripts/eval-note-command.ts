import { PGlite } from '@electric-sql/pglite';
import { loadEnvFile } from 'node:process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { newNote } from '../src/domain.js';
import { workCommandOnce } from '../server/command-worker.js';
import type { Database } from '../server/database.js';

try {
  loadEnvFile('.notto-dev/ai.env');
} catch {}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY für den expliziten Live-Test erforderlich.');
const pg = new PGlite();
const db = {
  query: async (sql: string, args?: any[]) => {
    const r = await pg.query(sql, args);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  connect: async () => ({ ...db, release() {} }),
} as unknown as Database;
try {
  await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const user = randomUUID(),
    id = randomUUID();
  const prompt =
    'Wähle fünf für Noto passende Icons oder Komponenten von dieser Seite aus. Erkläre ihren Nutzen kurz und zeige jeweils einen Screenshot. Verwende die Demo-Komponenten, nicht die Seitennavigation.';
  const note = newNote(
    user,
    `Noto-Komponenten\nhttps://www.shad-table.dev/animated-icons-table\n/ki ${prompt}`,
  );
  await pg.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    'command-eval@test.invalid',
    'unused',
  ]);
  await pg.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
    user,
    note.id,
    note.revision,
    JSON.stringify(note),
  ]);
  await pg.query('INSERT INTO ai_settings(user_id,document) VALUES($1,$2)', [
    user,
    JSON.stringify({
      enabled: true,
      auto: false,
      model: 'gpt-4.1-mini',
      excludedTags: '',
      excludedNotes: [],
    }),
  ]);
  await pg.query(
    'INSERT INTO note_commands(id,user_id,note_id,revision,prompt,note_content,model) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, user, note.id, note.revision, prompt, note.content, 'gpt-4.1-mini'],
  );
  await workCommandOnce(db, { models: ['gpt-4.1-mini'], openaiKey: process.env.OPENAI_API_KEY });
  const job: any = (await pg.query('SELECT status,stage,error,result FROM note_commands WHERE id=$1', [id]))
    .rows[0];
  await mkdir('output/command-eval', { recursive: true });
  await writeFile('output/command-eval/result.json', JSON.stringify(job, null, 2));
  console.log(JSON.stringify(job, null, 2));
  const images: any[] = (await pg.query('SELECT id,bytes FROM command_images WHERE command_id=$1', [id]))
    .rows;
  for (const image of images)
    await writeFile(`output/command-eval/${image.id}.jpg`, Buffer.from(image.bytes));
  console.log(`Saved ${images.length} real screenshots.`);
  if (job.status !== 'done' || !images.length) process.exitCode = 1;
} finally {
  await pg.close();
}
