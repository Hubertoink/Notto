import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './database.js';
import { hostingStorageSchema, type StorageReport } from '../src/storage.js';

export function storageRoutes(
  app: FastifyInstance,
  db: Database,
  env: { dataDir: string; storageAdminEmail?: string },
) {
  app.get('/api/storage', async (req): Promise<StorageReport> => {
    const user = req.nottoUser!.id;
    const categories: StorageReport['categories'] = [];
    for (const [key, label, table, expression] of [
      ['notes', 'Notizen und Versionshistorie', 'notes', 'octet_length(document::text)'],
      ['attachments', 'Bilder und Dokumente', 'attachments', 'size'],
      ['knowledge', 'Wissen, Analysen und Aufgaben', 'knowledge', 'octet_length(document::text)'],
      [
        'commands',
        'KI-Aufträge und Ergebnisse',
        'note_commands',
        'octet_length(row_to_json(note_commands)::text)',
      ],
      ['document-cache', 'Dokument-Kontextcache', 'document_context_cache', 'octet_length(document::text)'],
      [
        'youtube-cache',
        'YouTube-Transkriptcache',
        'youtube_transcript_cache',
        'octet_length(document::text)',
      ],
    ]) {
      const { rows } = await db.query(
        `SELECT count(*) AS count,coalesce(sum(${expression}),0) AS bytes FROM ${table} WHERE user_id=$1`,
        [user],
      );
      categories.push({ key, label, count: Number(rows[0].count), bytes: Number(rows[0].bytes) });
    }
    const images = await db.query(
      'SELECT count(*) AS count,coalesce(sum(octet_length(i.bytes)),0) AS bytes FROM command_images i JOIN note_commands c ON c.id=i.command_id WHERE c.user_id=$1',
      [user],
    );
    categories.push({
      key: 'command-images',
      label: 'Bilder aus KI-Aufträgen',
      count: Number(images.rows[0].count),
      bytes: Number(images.rows[0].bytes),
    });
    const trash = await db.query(
      "SELECT count(*) AS count FROM notes WHERE user_id=$1 AND document->>'deleted'='true'",
      [user],
    );
    const history = await db.query(
      "SELECT coalesce(sum(octet_length((document->'history')::text)),0) AS bytes FROM notes WHERE user_id=$1",
      [user],
    );
    const largest = await db.query(
      'SELECT id,name,size AS bytes FROM attachments WHERE user_id=$1 ORDER BY size DESC,id LIMIT 10',
      [user],
    );
    let hosting: StorageReport['hosting'] = null;
    if (env.storageAdminEmail && req.nottoUser!.email === env.storageAdminEmail) {
      try {
        const parsed = hostingStorageSchema.safeParse(
          JSON.parse(await readFile(join(env.dataDir, '.hosting-storage.json'), 'utf8')),
        );
        if (!parsed.success) throw new Error('Ungültiger Hosting-Speicherbericht.');
        hosting = parsed.data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      measuredAt: new Date().toISOString(),
      categories,
      totalBytes: categories.reduce((total, item) => total + item.bytes, 0),
      trashCount: Number(trash.rows[0].count),
      historyBytes: Number(history.rows[0].bytes),
      largestAttachments: largest.rows.map((row) => ({
        id: row.id,
        name: row.name,
        bytes: Number(row.bytes),
      })),
      hosting,
    };
  });
  app.put('/api/storage/cache', async (req) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM document_context_cache WHERE user_id=$1', [req.nottoUser!.id]);
      await client.query('DELETE FROM youtube_transcript_cache WHERE user_id=$1', [req.nottoUser!.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });
}
