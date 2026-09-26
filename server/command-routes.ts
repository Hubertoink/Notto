import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { currentContent, contentRevision, type Note } from '../src/domain.js';
import { noteAllowed } from '../src/evidence-policy.js';
import { commandUrls, noteCommands } from '../src/note-command.js';
import type { AIEnvironment } from './openai.js';
import { limit, type Database } from './database.js';
import { publicUrl } from './browser-network.js';

const fields = 'id,note_id,revision,prompt,status,stage,error,result,created_at';
const fail = (message: string, statusCode: number): never => {
  throw Object.assign(new Error(message), { statusCode });
};

// Called inside the note-save transaction. Synchronization retries and later
// edits must not run the same instruction again; an explicit retry still can.
export async function queueSavedCommands(
  client: Pick<Database, 'query'>,
  user: string,
  note: Note,
  env: AIEnvironment,
) {
  if (note.deleted) return;
  const prompts = [
    ...new Set(
      noteCommands(note.content)
        .map((c) => c.prompt)
        .filter(Boolean),
    ),
  ];
  if (!prompts.length) return;
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
  const settings = (await client.query('SELECT document FROM ai_settings WHERE user_id=$1', [user])).rows[0]
    ?.document;
  for (const prompt of prompts) {
    if (
      (
        await client.query(
          'SELECT id FROM note_commands WHERE user_id=$1 AND note_id=$2 AND prompt=$3 LIMIT 1',
          [user, note.id, prompt],
        )
      ).rows.length
    )
      continue;
    const counts = (
      await client.query(
        "SELECT count(*) FILTER (WHERE status IN ('pending','running'))::int AS active, count(*) FILTER (WHERE created_at>now()-interval '1 hour')::int AS recent FROM note_commands WHERE user_id=$1",
        [user],
      )
    ).rows[0];
    let error = !env.openaiKey
      ? 'OpenAI ist auf dem Server noch nicht eingerichtet.'
      : !settings?.enabled || !noteAllowed(note, settings)
        ? 'KI für diese Notiz zuerst in „Wissen & KI“ freigeben.'
        : prompt.length > 4000 || note.content.length > 60000
          ? 'Bitte den Auftrag auf 4.000 und die Notiz auf 60.000 Zeichen kürzen.'
          : counts.active >= 3
            ? 'Es laufen bereits drei Aufträge. Bitte später erneut starten.'
            : counts.recent >= 12
              ? 'Maximal zwölf Aufträge pro Stunde. Bitte später erneut starten.'
              : null;
    try {
      for (const url of commandUrls(prompt)) publicUrl(url);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Ungültiger Link.';
    }
    await client.query(
      'INSERT INTO note_commands(id,user_id,note_id,revision,prompt,note_content,model,status,stage,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        randomUUID(),
        user,
        note.id,
        contentRevision(note),
        prompt,
        note.content,
        settings?.model || '',
        error ? 'failed' : 'pending',
        error ? 'Nicht gestartet' : 'Wartet',
        error,
      ],
    );
  }
}
export function commandRoutes(app: FastifyInstance, db: Database, env: AIEnvironment) {
  app.get('/api/commands', async (req) => {
    const { noteId } = z.object({ noteId: z.uuid() }).parse(req.query);
    return {
      commands: (
        await db.query(
          `SELECT ${fields} FROM note_commands WHERE user_id=$1 AND note_id=$2 ORDER BY created_at DESC LIMIT 50`,
          [req.nottoUser!.id, noteId],
        )
      ).rows,
    };
  });
  app.put('/api/commands/:id', async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const input = z
      .object({ noteId: z.uuid(), revision: z.uuid(), prompt: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    const user = req.nottoUser!.id;
    const existing = (
      await db.query(`SELECT ${fields} FROM note_commands WHERE user_id=$1 AND id=$2`, [user, id])
    ).rows[0];
    if (existing) {
      if (
        existing.note_id !== input.noteId ||
        existing.prompt !== input.prompt ||
        existing.revision !== input.revision
      )
        fail('Auftrag-ID wird bereits verwendet.', 409);
      return { command: existing };
    }
    if (!env.openaiKey) fail('OpenAI ist auf dem Server noch nicht eingerichtet.', 503);
    const row = (
      await db.query(
        'SELECT n.document,s.document AS settings FROM notes n LEFT JOIN ai_settings s ON s.user_id=n.user_id WHERE n.user_id=$1 AND n.id=$2',
        [user, input.noteId],
      )
    ).rows[0];
    if (!row || row.document.deleted) fail('Notiz nicht gefunden.', 404);
    if (!row.settings?.enabled || !noteAllowed(row.document, row.settings))
      fail('KI für diese Notiz zuerst in „Wissen & KI“ freigeben.', 403);
    if (!currentContent(row.document, input.revision))
      fail('Bitte die aktuelle Notiz zuerst synchronisieren.', 409);
    if (row.document.content.length > 60000)
      fail('Für einen KI-Auftrag darf die Notiz höchstens 60.000 Zeichen enthalten.', 400);
    try {
      for (const url of commandUrls(input.prompt)) publicUrl(url);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Ungültiger Link.', 400);
    }
    await limit(db, `commands:${user}`, 12, 3600);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
      const active = (
        await client.query(
          "SELECT count(*)::int AS count FROM note_commands WHERE user_id=$1 AND status IN ('pending','running')",
          [user],
        )
      ).rows[0].count;
      if (active >= 3) fail('Es laufen bereits drei Aufträge. Bitte einen abschließen oder abbrechen.', 429);
      const recent = (
        await client.query(
          "SELECT count(*)::int AS count FROM note_commands WHERE user_id=$1 AND created_at>now()-interval '1 hour'",
          [user],
        )
      ).rows[0].count;
      if (recent >= 12) fail('Maximal zwölf Aufträge pro Stunde. Bitte später erneut starten.', 429);
      await client.query(
        'INSERT INTO note_commands(id,user_id,note_id,revision,prompt,note_content,model) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [
          id,
          user,
          input.noteId,
          contentRevision(row.document),
          input.prompt,
          row.document.content,
          row.settings.model,
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return {
      command: (await db.query(`SELECT ${fields} FROM note_commands WHERE user_id=$1 AND id=$2`, [user, id]))
        .rows[0],
    };
  });
  app.put('/api/commands/:id/cancel', async (req) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    await db.query(
      "UPDATE note_commands SET status='cancelled',stage='Abgebrochen',lease_until=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','running')",
      [id, req.nottoUser!.id],
    );
    return { ok: true };
  });
  app.get('/api/commands/:id/images/:imageId', async (req, reply) => {
    const { id, imageId } = z.object({ id: z.uuid(), imageId: z.uuid() }).parse(req.params);
    const image = (
      await db.query(
        "SELECT i.bytes FROM command_images i JOIN note_commands c ON c.id=i.command_id WHERE i.id=$1 AND c.id=$2 AND c.user_id=$3 AND c.status='done'",
        [imageId, id, req.nottoUser!.id],
      )
    ).rows[0];
    if (!image) fail('Bild nicht gefunden.', 404);
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .send(Buffer.from(image.bytes));
  });
}
