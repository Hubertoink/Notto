import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { attachmentIds, contentRevision, type Note } from '../src/domain.js';
import { evidenceSchema } from '../src/evidence-policy.js';
import type { Database } from './database.js';

export async function sourceTexts(
  db: Database,
  userId: string,
  note: Note,
  records: any[],
  dataDir?: string,
) {
  const sources: z.infer<typeof evidenceSchema>[] = [
    { noteId: note.id, revision: contentRevision(note), text: note.content },
  ];
  for (const id of attachmentIds(note.content)) {
    let extraction = records
      .filter((r) => r.kind === 'extraction' && r.data?.id === id)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!extraction && id.endsWith('.pdf')) {
      if (!dataDir) throw new Error('PDF-Verarbeitung: Anhangspeicher fehlt.');
      // IDs from legacy notebooks are not necessarily valid filesystem names.
      if (!/^[a-f0-9-]{36}\.pdf$/.test(id)) throw new Error('Ungültige PDF-Referenz.');
      const bytes = new Uint8Array(await readFile(join(dataDir, userId, id)));
      if (bytes.length > 12 * 1024 * 1024) throw new Error('PDF zu groß.');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
      const pdf = await loading.promise;
      const pages = [];
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
    }
    if (extraction)
      for (const page of extraction.data.pages ?? []) {
        const parsed = evidenceSchema.safeParse(page);
        if (parsed.success)
          sources.push({ ...parsed.data, noteId: note.id, revision: contentRevision(note) });
      }
  }
  return sources;
}
