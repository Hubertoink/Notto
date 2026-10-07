import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { attachmentIds } from '../src/domain.js';
import { currentAnalysis } from '../src/analysis-current.js';
import { noteAllowed } from '../src/evidence-policy.js';
import { withoutNoteCommands } from '../src/note-command.js';
import type { Database } from './database.js';

/** Retry exhausted file reads only once the current, permitted note's files are readable. */
export async function resumeAttachmentAnalyses(db: Database, dataDir: string) {
  const { rows } = await db.query(
    `SELECT j.id,j.user_id,j.revision,j.error,n.document,s.document AS settings
     FROM jobs j JOIN notes n ON n.user_id=j.user_id AND n.id=j.note_id
     JOIN ai_settings s ON s.user_id=j.user_id
     WHERE j.status='failed' AND j.kind='analysis' AND j.error LIKE 'ENOENT:%'`,
  );
  let resumed = 0;
  for (const job of rows) {
    const note = job.document,
      settings = job.settings;
    if (
      note.deleted ||
      !settings?.enabled ||
      !settings.auto ||
      !noteAllowed(note, settings) ||
      !withoutNoteCommands(note.content).trim() ||
      !currentAnalysis(note, job.revision)
    )
      continue;
    const ids = attachmentIds(note.content).filter((id) => /^[a-f0-9-]{36}\.(pdf|docx|txt|md)$/i.test(id));
    const paths = ids.map((id) => join(dataDir, job.user_id, id));
    if (!paths.some((path) => job.error.includes(`'${path}'`))) continue;
    try {
      await Promise.all(paths.map((path) => access(path, constants.R_OK)));
    } catch {
      continue;
    }
    const result = await db.query(
      `UPDATE jobs SET status='pending',attempts=0,available_at=now(),lease_until=NULL,error=NULL
       WHERE id=$1 AND status='failed' AND error=$2 RETURNING id`,
      [job.id, job.error],
    );
    resumed += result.rowCount ?? 0;
  }
  return resumed;
}
