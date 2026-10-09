import { currentContent, type Note } from './domain.js';
import { plainNoteLinks } from './note-links.js';
import { withoutNoteCommands } from './note-command.js';
import { sameAnalysisContent } from './analysis-equivalence.js';

/** Analysis reads note text and attachments, not the destinations of inline note links. */
export function analysisContent(content: string) {
  return plainNoteLinks(withoutNoteCommands(content)).trimEnd();
}
export function currentAnalysis(
  note: Pick<Note, 'revision' | 'content'> & Partial<Pick<Note, 'history'>>,
  revision: string,
) {
  if (currentContent(note, revision)) return true;
  const previous = note.history?.find((entry) => entry.revision === revision);
  return !!previous && sameAnalysisContent(analysisContent(previous.content), analysisContent(note.content));
}
