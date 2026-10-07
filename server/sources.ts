import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { attachmentIds, contentRevision, type Note } from '../src/domain.js';
import { evidenceSchema } from '../src/evidence-policy.js';
import type { Database } from './database.js';
import { withoutNoteCommands } from '../src/note-command.js';
import { documentText, isTextDocument } from '../src/document-text.js';

export async function sourceTexts(
  db: Database,
  userId: string,
  note: Note,
  records: any[],
  dataDir?: string,
) {
  const sources: z.infer<typeof evidenceSchema>[] = [
    { noteId: note.id, revision: contentRevision(note), text: withoutNoteCommands(note.content) },
  ];
  for (const id of attachmentIds(note.content)) {
    let extraction = records
      .filter((r) => r.kind === 'extraction' && r.data?.id === id && (!r.noteId || r.noteId === note.id))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!extraction && (id.endsWith('.pdf') || isTextDocument(id))) {
      // Attachment IDs are immutable within a user. Reuse the extraction, while
      // retaining a note-specific record for consent and citation freshness checks.
      const shared = (
        await db.query(
          "SELECT document FROM knowledge WHERE user_id=$1 AND document->>'kind'='extraction' AND document->'data'->>'id'=$2 ORDER BY document->>'at' DESC,id DESC LIMIT 1",
          [userId, id],
        )
      ).rows[0]?.document;
      if (shared?.kind === 'extraction' && shared.data?.id === id && Array.isArray(shared.data.pages)) {
        extraction = {
          ...shared,
          id: randomUUID(),
          scope: userId,
          noteId: note.id,
          revision: contentRevision(note),
          at: new Date().toISOString(),
          data: {
            ...shared.data,
            pages: shared.data.pages.map((page: unknown) => ({
              ...evidenceSchema.parse(page),
              noteId: note.id,
              revision: contentRevision(note),
            })),
          },
        };
        await db.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
          userId,
          extraction.id,
          JSON.stringify(extraction),
        ]);
        records.push(extraction);
      }
    }
    if (!extraction && (id.endsWith('.pdf') || isTextDocument(id))) {
      if (!dataDir) throw new Error('PDF-Verarbeitung: Anhangspeicher fehlt.');
      // IDs from legacy notebooks are not necessarily valid filesystem names.
      if (!/^[a-f0-9-]{36}\.(pdf|docx|txt|md)$/.test(id)) throw new Error('Ungültige Dokumentreferenz.');
      const bytes = new Uint8Array(await readFile(join(dataDir, userId, id)));
      if (bytes.length > 12 * 1024 * 1024) throw new Error('PDF zu groß.');
      const pages = [];
      if (isTextDocument(id)) {
        pages.push({
          noteId: note.id,
          revision: contentRevision(note),
          attachment: id,
          text: documentText(id, bytes) || '[Kein Text erkannt. OCR erforderlich.]',
        });
      } else {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
        const pdf = await loading.promise;
        try {
          if (pdf.numPages > 100) throw new Error('Bitte das PDF auf höchstens 100 Seiten aufteilen.');
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items
              .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
              .join('')
              .trim();
            pages.push({
              noteId: note.id,
              revision: contentRevision(note),
              attachment: id,
              page: pageNumber,
              text: text || '[Kein Text erkannt. OCR erforderlich.]',
            });
          }
        } finally {
          await loading.destroy();
        }
      }
      extraction = {
        id: randomUUID(),
        scope: userId,
        noteId: note.id,
        revision: contentRevision(note),
        kind: 'extraction',
        at: new Date().toISOString(),
        data: { id, pages, ocr: false },
      };
      // Extraction is local computation; analysis checks current consent again before sending.
      await db.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
        userId,
        extraction.id,
        JSON.stringify(extraction),
      ]);
      records.push(extraction);
    }
    if (extraction)
      for (const page of extraction.data.pages ?? []) {
        const parsed = evidenceSchema.safeParse(page);
        if (parsed.success)
          sources.push({
            ...parsed.data,
            noteId: note.id,
            revision: contentRevision(note),
            extractionId: extraction.id,
          });
      }
  }
  return sources;
}
