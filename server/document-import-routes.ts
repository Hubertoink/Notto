import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from './database.js';
import { limit } from './database.js';
import { importWebDocument } from './document-import.js';
import { checkDocumentAvailability } from './document-availability.js';
export function documentImportRoutes(app: FastifyInstance, db: Database, dataDir: string) {
  app.put('/api/documents/check', async (req) => {
    const input = z
      .object({ noteId: z.uuid(), url: z.string().url().max(3000), refresh: z.boolean().optional() })
      .parse(req.body);
    const note = (
      await db.query('SELECT document FROM notes WHERE user_id=$1 AND id=$2', [
        req.nottoUser!.id,
        input.noteId,
      ])
    ).rows[0]?.document;
    if (!note || note.deleted)
      throw Object.assign(new Error('Ausgangsnotiz nicht gefunden.'), { statusCode: 404 });
    await limit(db, `document-check:${req.nottoUser!.id}`, 240, 3600);
    return { availability: await checkDocumentAvailability(input.url, input.refresh) };
  });
  app.put('/api/documents/import', async (req) => {
    const input = z
      .object({ noteId: z.uuid(), url: z.string().url().max(3000), title: z.string().max(500).optional() })
      .parse(req.body);
    await limit(db, `document-import:${req.nottoUser!.id}`, 20, 3600);
    return { document: await importWebDocument(db, dataDir, req.nottoUser!.id, input) };
  });
}
