import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from './database.js';
import { limit } from './database.js';
import { importWebDocument } from './document-import.js';
export function documentImportRoutes(app: FastifyInstance, db: Database, dataDir: string) {
  app.put('/api/documents/import', async (req) => {
    const input = z
      .object({ noteId: z.uuid(), url: z.string().url().max(3000), title: z.string().max(500).optional() })
      .parse(req.body);
    await limit(db, `document-import:${req.nottoUser!.id}`, 20, 3600);
    return { document: await importWebDocument(db, dataDir, req.nottoUser!.id, input) };
  });
}
