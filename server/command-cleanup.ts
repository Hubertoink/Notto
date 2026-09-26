import { reviseNote, type Note } from '../src/domain.js';
import { withoutNoteCommands } from '../src/note-command.js';
import type { Database } from './database.js';

/** Within the caller's transaction; preserve edits made while the job ran. */
export async function cleanCompletedPrompts(
  client: Pick<Database, 'query'>,
  user: string,
  noteId: string,
  prompts: string[],
) {
  const row = (
    await client.query('SELECT document FROM notes WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, noteId])
  ).rows[0];
  if (!row || row.document.deleted) return;
  const note = row.document as Note;
  const content = withoutNoteCommands(note.content, prompts);
  if (content === note.content) return;
  const updated = reviseNote(note, { content });
  await client.query('UPDATE notes SET revision=$3,document=$4,updated_at=now() WHERE user_id=$1 AND id=$2', [
    user,
    noteId,
    updated.revision,
    JSON.stringify(updated),
  ]);
  // Let the ordinary analysis inspect only the remaining note, once.
  await client.query(
    'INSERT INTO jobs(id,user_id,note_id,revision) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [crypto.randomUUID(), user, noteId, updated.revision],
  );
  return updated;
}
