import { lexicalScore, searchTerms, splitEvidence, type SearchChunk } from './retrieval.js';

// A conservative serialized-text budget, including source metadata. Model output,
// instructions and the command itself have separate headroom.
export const CONTEXT_BUDGET = 48000;
export const PREPARATION_VERSION = 1;
export interface DocumentPreparation {
  version: number;
  chunks: { text: string; page?: number }[];
  overview: { text: string; page?: number }[];
}
export interface ContextReport {
  mode: 'complete' | 'selected' | 'sectionwise';
  totalCharacters: number;
  usedCharacters: number;
  warnings: string[];
  sources: { noteId: string; revision: string; attachment?: string; page?: number; title?: string }[];
}
export const readableSource = (source: SearchChunk) =>
  !!source.text.trim() && !source.text.startsWith('[Kein Text erkannt.');
const documentKey = (source: SearchChunk) => source.attachment ?? source.noteId;
const cost = (source: SearchChunk) => JSON.stringify(source).length + 2;

/** An extractive overview: always original text, never a generated substitute for evidence. */
export function prepareDocument(pages: { text: string; page?: number }[]): DocumentPreparation {
  const chunks = splitEvidence(pages.map((page) => ({ ...page, noteId: '', revision: '' }))).map(
    ({ text, page }) => ({ text, page }),
  );
  const overview: DocumentPreparation['overview'] = [];
  for (let i = 0; i < Math.min(4, chunks.length); i++) {
    const chunk = chunks[Math.round((i * (chunks.length - 1)) / Math.max(1, Math.min(4, chunks.length) - 1))];
    overview.push({ ...chunk, text: chunk.text.slice(0, 450) });
  }
  return { version: PREPARATION_VERSION, chunks, overview };
}

export function completeDocumentRequest(query: string) {
  const text = query.toLocaleLowerCase('de');
  // A summary scoped to the current thought is retrieval, a document summary is a full read.
  if (
    /\b(zur|zu dieser|für diese[ nr]?|bezogen auf|im kontext)\b.*\bnotiz\b/u.test(text) &&
    !/vollständig|gesamt|alle\s+(?:anforderungen|seiten|abschnitte)/u.test(text)
  )
    return false;
  return /zusammenfass|fasse\b.*\bzusammen|summari[sz]e|vollständig|gesamte[nmrs]?\s+(?:pdf|dokument|text)|alle\s+(?:anforderungen|seiten|abschnitte)|komplette[nmrs]?\s+(?:pdf|dokument|text)/u.test(
    text,
  );
}

export function contextReport<T extends SearchChunk>(
  all: T[],
  selected: T[],
  mode: ContextReport['mode'],
  warnings: string[],
): ContextReport {
  return {
    mode,
    totalCharacters: all.reduce((sum, s) => sum + s.text.length, 0),
    usedCharacters: selected.reduce((sum, s) => sum + s.text.length, 0),
    warnings,
    sources: [
      ...new Map(
        selected.map(({ noteId, revision, attachment, page, title }) => [
          JSON.stringify([noteId, attachment, page]),
          { noteId, revision, attachment, page, title },
        ]),
      ).values(),
    ],
  };
}

export function selectDocumentContext<T extends SearchChunk>(
  all: T[],
  noteId: string,
  query: string,
  preparations = new Map<string, DocumentPreparation>(),
  budget = CONTEXT_BUDGET,
) {
  const warnings = all
    .filter((s) => !readableSource(s))
    .map(
      (s) =>
        `${s.title || (s.attachment ? 'Anhang' : 'Notiz')}${s.page ? `, Seite ${s.page}` : ''}: Kein Text erkannt; Texterkennung erforderlich.`,
    );
  const seen = new Set<string>();
  const readable = all.filter(readableSource).filter((source) => {
    const key = JSON.stringify([documentKey(source), source.page, source.text]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (readable.reduce((sum, s) => sum + cost(s), 2) <= budget)
    return { sources: readable, report: contextReport(all, readable, 'complete', warnings) };

  const selected: T[] = [];
  let remaining = budget - 2;
  const add = (source: T) => {
    if (
      selected.some(
        (s) =>
          documentKey(s) === documentKey(source) && s.page === source.page && s.text.includes(source.text),
      )
    )
      return false;
    if (cost(source) > remaining) return false;
    selected.push(source);
    remaining -= cost(source);
    return true;
  };
  const note = readable.filter((s) => s.noteId === noteId && !s.attachment);
  for (const source of note)
    add({ ...source, text: source.text.slice(0, Math.min(12000, Math.floor(budget / 3))) });
  const documents = new Map<string, T[]>();
  for (const source of readable) {
    if (note.includes(source) && selected.some((s) => s.text === source.text)) continue;
    const key = documentKey(source);
    documents.set(key, [...(documents.get(key) ?? []), source]);
  }
  const chunks: T[] = [];
  const overviews: T[] = [];
  for (const [key, pages] of documents) {
    const prepared = preparations.get(key) ?? prepareDocument(pages);
    const bind = (chunk: { text: string; page?: number }) => ({
      ...(pages.find((p) => p.page === chunk.page) ?? pages[0]),
      ...chunk,
    });
    chunks.push(...prepared.chunks.map(bind));
    overviews.push(...prepared.overview.map(bind));
  }
  const noteQuery = note
    .map((s) => s.text)
    .join('\n')
    .slice(0, 12000);
  const terms = searchTerms(`${query} ${noteQuery}`);
  const frequency = new Map(
    terms.map((term) => [term, chunks.filter((c) => c.text.toLocaleLowerCase('de').includes(term)).length]),
  );
  const ranked = chunks
    .map((source, index) => ({
      source,
      index,
      score:
        3 * lexicalScore(source, query) +
        lexicalScore(source, noteQuery) +
        terms.reduce(
          (sum, term) =>
            sum +
            (source.text.toLocaleLowerCase('de').includes(term)
              ? 1 / Math.sqrt(frequency.get(term) || 1)
              : 0),
          0,
        ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  // Cover each document before spending the rest on the strongest passages.
  const represented = new Set<string>();
  for (const hit of ranked) {
    const key = documentKey(hit.source);
    if (!represented.has(key) && add(hit.source)) represented.add(key);
  }
  let overviewBudget = Math.min(4000, Math.floor(remaining / 5));
  for (const overview of overviews) {
    if (cost(overview) <= overviewBudget && add(overview)) overviewBudget -= cost(overview);
  }
  // Adjacent passages preserve qualifications and counterarguments around a match.
  for (const hit of ranked) {
    add(hit.source);
    if (hit.score > 0) {
      const previous = chunks[hit.index - 1];
      if (previous && documentKey(previous) === documentKey(hit.source)) add(previous);
      const next = chunks[hit.index + 1];
      if (next && documentKey(next) === documentKey(hit.source)) add(next);
    }
  }
  warnings.push(
    'Passende Originalstellen und kurze Dokumentauszüge wurden ausgewählt; die Anhänge wurden nicht vollständig von der KI geprüft.',
  );
  return { sources: selected, report: contextReport(all, selected, 'selected', warnings) };
}

/** Every character is read, including long individual pages. No top-k selection here. */
export function documentBatches<T extends SearchChunk>(sources: T[], budget = CONTEXT_BUDGET): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [],
    size = 2;
  for (const source of sources.filter(readableSource)) {
    const capacity = budget - cost({ ...source, text: '' }) - 2;
    if (capacity < 1) throw new Error('Quellenangaben überschreiten das Kontextbudget.');
    for (let offset = 0; offset < source.text.length;) {
      let length = Math.min(capacity, source.text.length - offset);
      let part = { ...source, text: source.text.slice(offset, offset + length) };
      while (cost(part) + 2 > budget) {
        length = Math.floor(length * 0.9);
        if (!length) throw new Error('Quellenabschnitt überschreitet das Kontextbudget.');
        part = { ...source, text: source.text.slice(offset, offset + length) };
      }
      if (size + cost(part) > budget && batch.length) {
        batches.push(batch);
        batch = [];
        size = 2;
      }
      batch.push(part);
      size += cost(part);
      offset += length;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}
