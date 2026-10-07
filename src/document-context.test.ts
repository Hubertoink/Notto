import { expect, it } from 'vitest';
import type { SearchChunk } from './retrieval';
import {
  completeDocumentRequest,
  CONTEXT_BUDGET,
  documentBatches,
  prepareDocument,
  selectDocumentContext,
} from './document-context';
const note: SearchChunk = { noteId: 'n', revision: 'r', text: 'Ownership und Beteiligung im Jugendhaus' };
const page = (attachment: string, page: number, text: string) => ({
  ...note,
  attachment,
  page,
  text,
  extractionId: 'e',
});

it('finds evidence near the end of large PDFs, keeps both documents and stays within budget', () => {
  const sources = [
    note,
    ...Array.from({ length: 80 }, (_, i) =>
      page(
        i < 40 ? 'a.pdf' : 'b.pdf',
        i + 1,
        i === 79
          ? 'Ownership fördert Beteiligung. Einschränkung: Entscheidungsspielräume müssen vereinbart werden.'
          : 'Unabhängiger Hintergrund. '.repeat(200),
      ),
    ),
  ];
  const result = selectDocumentContext(sources, 'n', note.text);
  expect(JSON.stringify(result.sources).length).toBeLessThanOrEqual(CONTEXT_BUDGET);
  expect(result.sources[0]).toEqual(note);
  expect(result.sources.some((s) => s.page === 80 && s.text.includes('Einschränkung'))).toBe(true);
  expect(new Set(result.sources.filter((s) => s.attachment).map((s) => s.attachment)).size).toBe(2);
  for (const s of result.sources)
    expect(
      sources.some(
        (original) =>
          original.attachment === s.attachment && original.page === s.page && original.text.includes(s.text),
      ),
    ).toBe(true);
  expect(result.report.mode).toBe('selected');
});

it('retains complete small sources and reports unreadable pages without citing placeholders', () => {
  const result = selectDocumentContext(
    [
      note,
      page('a.pdf', 1, 'Ein lesbarer Satz.'),
      page('a.pdf', 2, '[Kein Text erkannt. OCR erforderlich.]'),
    ],
    'n',
    'Ownership',
  );
  expect(result.sources).toHaveLength(2);
  expect(result.report.warnings[0]).toContain('Seite 2');
});

it('preserves every character and page across full-read batches, including JSON escaping', () => {
  const sources = [page('a.pdf', 1, '"\\\n😀'.repeat(18000)), page('a.pdf', 2, 'Letzte Anforderung.')];
  const batches = documentBatches(sources);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every((batch) => JSON.stringify(batch).length <= CONTEXT_BUDGET)).toBe(true);
  for (const source of sources)
    expect(
      batches
        .flat()
        .filter((s) => s.page === source.page)
        .map((s) => s.text)
        .join(''),
    ).toBe(source.text);
});

it('keeps cached overview excerpts verbatim and binds them to the current note', () => {
  const original = Array.from({ length: 30 }, (_, i) => ({
    text: `Seite ${i} Beteiligung. `.repeat(200),
    page: i + 1,
  }));
  const prepared = prepareDocument(original);
  expect(prepared.overview.every((s) => original.find((p) => p.page === s.page)?.text.includes(s.text))).toBe(
    true,
  );
  const selected = selectDocumentContext(
    [note, ...original.map((p) => page('a.pdf', p.page, p.text))],
    'n',
    'Beteiligung',
    new Map([['a.pdf', prepared]]),
  );
  expect(selected.sources.every((s) => s.noteId === 'n' && s.revision === 'r')).toBe(true);
});

it('distinguishes focused questions from whole-document work', () => {
  expect(completeDocumentRequest('Fasse das gesamte PDF zusammen')).toBe(true);
  expect(completeDocumentRequest('Prüfe alle Anforderungen')).toBe(true);
  expect(completeDocumentRequest('Welche Aussagen helfen bei Ownership?')).toBe(false);
  expect(completeDocumentRequest('Fasse das für diese Notiz zusammen')).toBe(false);
});
