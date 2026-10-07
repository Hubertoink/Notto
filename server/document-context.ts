import { createHash } from 'node:crypto';
import {
  prepareDocument,
  PREPARATION_VERSION,
  readableSource,
  selectDocumentContext,
  type DocumentPreparation,
} from '../src/document-context.js';
import type { SearchChunk } from '../src/retrieval.js';
import type { Database } from './database.js';

export async function serverDocumentContext<T extends SearchChunk>(
  db: Database,
  user: string,
  sources: T[],
  noteId: string,
  query: string,
) {
  const preparations = new Map<string, DocumentPreparation>();
  const attachments = [
    ...new Set(
      sources
        .filter(readableSource)
        .map((s) => s.attachment)
        .filter((id): id is string => !!id),
    ),
  ];
  for (const attachment of attachments) {
    const pages = [
      ...new Map(
        sources
          .filter((s) => s.attachment === attachment && readableSource(s))
          .map(({ text, page }) => [JSON.stringify([page, text]), { text, page }]),
      ).values(),
    ];
    // Independent of the note revision; OCR/content changes invalidate this cache.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([PREPARATION_VERSION, pages]))
      .digest('hex');
    const cached = (
      await db.query(
        'SELECT document FROM document_context_cache WHERE user_id=$1 AND attachment_id=$2 AND fingerprint=$3',
        [user, attachment, fingerprint],
      )
    ).rows[0]?.document;
    const preparation: DocumentPreparation =
      cached?.version === PREPARATION_VERSION &&
      Array.isArray(cached.chunks) &&
      Array.isArray(cached.overview)
        ? cached
        : prepareDocument(pages);
    if (preparation !== cached)
      await db.query(
        'INSERT INTO document_context_cache(user_id,attachment_id,fingerprint,document) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,attachment_id) DO UPDATE SET fingerprint=excluded.fingerprint,document=excluded.document',
        [user, attachment, fingerprint, JSON.stringify(preparation)],
      );
    preparations.set(attachment, preparation);
  }
  return selectDocumentContext(sources, noteId, query, preparations);
}
