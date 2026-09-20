import type { Note } from './domain';
import { currentContent } from './domain';
import {
  decisionKey,
  knowledge,
  resolvedDecision,
  type Analysis,
  type KnowledgeRecord,
  type Suggestion,
} from './intelligence';

export interface Task {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  note?: Note;
  suggestion?: Suggestion;
}
export function newest(records: KnowledgeRecord[]) {
  return [...records].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
export function noteAnalysis(records: KnowledgeRecord[], note: Note) {
  return newest(
    records.filter((r) => r.scope === note.scope && r.noteId === note.id && r.kind === 'analysis'),
  )[0];
}
export function tasksFor(notes: Note[], records: KnowledgeRecord[], scope: string): Task[] {
  const scoped = newest(records.filter((r) => r.scope === scope));
  const tasks = new Map<string, Task>();
  for (const r of scoped.filter((r) => r.kind === 'manual-task')) {
    if (!tasks.has(r.noteId)) {
      const data = r.data as { title: string; done: boolean };
      tasks.set(r.noteId, { id: r.noteId, title: data.title, done: data.done, detail: '' });
    }
  }
  for (const note of notes.filter((n) => n.scope === scope && !n.deleted)) {
    const analysis = noteAnalysis(scoped, note);
    const current =
      analysis && currentContent(note, analysis.revision) ? (analysis.data as Analysis).suggestions : [];
    const retained = scoped
      .filter((r) => r.kind === 'analysis' && r.noteId === note.id)
      .flatMap((r) => (r.data as Analysis).suggestions)
      .filter((item) => {
        const decision = resolvedDecision(scoped, decisionKey(note.id, item));
        return decision?.status === 'accepted' || decision?.status === 'done';
      });
    for (const item of [...current, ...retained]) {
      if (item.kind !== 'task') continue;
      const id = decisionKey(note.id, item);
      if (tasks.has(id)) continue;
      const decision = resolvedDecision(scoped, id);
      if (decision?.status === 'dismissed') continue;
      tasks.set(id, {
        id,
        title: decision?.title ?? item.title,
        detail: decision?.detail ?? item.detail,
        done: decision?.status === 'done',
        note,
        suggestion: item,
      });
    }
  }
  return [...tasks.values()].sort(
    (a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title, 'de'),
  );
}
export async function addTask(scope: string, title: string) {
  if (!title.trim()) return;
  await knowledge.append({ scope, id: crypto.randomUUID(), revision: crypto.randomUUID() }, 'manual-task', {
    title: title.trim(),
    done: false,
  });
}
export async function checkTask(scope: string, task: Task, done: boolean) {
  if (task.note && task.suggestion) {
    await knowledge.append(task.note, 'decision', {
      key: task.id,
      status: done ? 'done' : 'accepted',
      title: task.title,
      detail: task.detail,
    });
  } else {
    await knowledge.append({ scope, id: task.id, revision: crypto.randomUUID() }, 'manual-task', {
      title: task.title,
      done,
    });
  }
}
