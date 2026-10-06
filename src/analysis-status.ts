import type { Note } from './domain';
import type { BackgroundJob } from './AIActivity';
import { currentAnalysis } from './analysis-current';

export function analysisJob(note: Note, jobs: BackgroundJob[]) {
  const latest = jobs
    .filter(
      (job) => job.note_id === note.id && job.kind === 'analysis' && currentAnalysis(note, job.revision),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest && ['running', 'pending', 'failed'].includes(latest.status) ? latest : undefined;
}
