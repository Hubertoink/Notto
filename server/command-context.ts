import type { Database } from './database.js';
import { sourceTexts } from './sources.js';
import { contextNotes } from '../src/source-context.js';
import { attachmentIds, titleOf, type AIContext, type Note } from '../src/domain.js';
import { completeDocumentRequest, documentBatches, contextReport } from '../src/document-context.js';
import { serverDocumentContext } from './document-context.js';
import { evidenceSchema } from '../src/evidence-policy.js';
import type { z } from 'zod';

export type ContextSource = z.infer<typeof evidenceSchema> & { title: string };

export async function commandContextSources(
  db: Database,
  user: string,
  current: Note,
  context: AIContext,
  settings: { excludedNotes: string[]; excludedTags: string },
  query: string,
  dataDir?: string,
) {
  const all = (await db.query('SELECT document FROM notes WHERE user_id=$1', [user])).rows.map(
    (row) => ({ ...row.document, scope: user }) as Note,
  );
  const selected = contextNotes(
    all.map((note) => (note.id === current.id ? current : note)),
    current,
    context,
    settings,
  );
  const records = (await db.query('SELECT document FROM knowledge WHERE user_id=$1', [user])).rows.map(
    (row) => row.document,
  );
  const warnings: string[] = [];
  let incomplete = false;
  const direct: ContextSource[] = [],
    related: ContextSource[] = [];
  for (const note of selected) {
    const explicit =
      note.id === current.id || (context.mode === 'selected' && context.sourceIds?.includes(note.id));
    try {
      const sources = (await sourceTexts(db, user, note, records, dataDir)).map((source) => ({
        ...source,
        title: titleOf(note.content) + (note.document ? ` · Version ${note.document.version}` : ''),
      }));
      const unreadable = sources.filter((source) => source.text.startsWith('[Kein Text erkannt.'));
      if (unreadable.length) incomplete = true;
      for (const id of attachmentIds(note.content))
        if (!sources.some((source) => source.attachment === id)) {
          incomplete = true;
          warnings.push(
            `${titleOf(note.content)}: Anhang ${id.split('.').at(-1)?.toUpperCase()} wurde noch nicht ausgelesen; Texterkennung erforderlich.`,
          );
        }
      for (const source of unreadable)
        warnings.push(
          `${source.title}${source.page ? `, Seite ${source.page}` : ''}: Kein Text erkannt; Texterkennung erforderlich.`,
        );
      // A link label alone must never stand in for an unreadable document.
      if (
        explicit &&
        note.document &&
        sources.filter((s) => s.attachment && !unreadable.includes(s)).length === 0
      )
        throw new Error(
          `${titleOf(note.content)} enthält noch keinen lesbaren Text. Bitte Texterkennung ausführen.`,
        );
      (explicit ? direct : related).push(
        ...sources.filter(
          (source) => !unreadable.includes(source) && (!note.document || !!source.attachment),
        ),
      );
    } catch (error) {
      if (explicit) throw error;
      incomplete = true;
      warnings.push(
        `${titleOf(note.content)}: ${error instanceof Error ? error.message : 'Dokument nicht lesbar.'}`,
      );
    }
  }
  for (const id of context.mode === 'selected' ? (context.sourceIds ?? []) : [])
    if (!selected.some((note) => note.id === id))
      throw new Error(
        'Eine ausgewählte Quelle ist nicht verfügbar oder von der KI ausgeschlossen. Bitte die Quellenauswahl prüfen.',
      );
  const allSources = [...direct, ...related];
  const prepared = await serverDocumentContext(db, user, allSources, current.id, query);
  const batches = completeDocumentRequest(query) ? documentBatches(allSources) : [];
  const fullRead = batches.length > 1;
  const sources = batches.length === 1 ? batches[0] : prepared.sources;
  warnings.push(...(batches.length ? [] : prepared.report.warnings));
  if (fullRead)
    warnings.push(
      'Alle lesbaren Abschnitte werden schrittweise ausgewertet; die Antwort wird aus belegten Teilergebnissen erstellt.',
    );
  const report = contextReport(
    allSources,
    fullRead ? allSources : sources,
    fullRead ? 'sectionwise' : batches.length ? 'complete' : prepared.report.mode,
    warnings,
  );
  return { sources, warnings, incomplete, report, batches: fullRead ? batches : [], allSources };
}
