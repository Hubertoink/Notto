import { expect, it } from 'vitest';
import { newNote, reviseNote, currentContent } from './domain';
import { analysisContent, currentAnalysis } from './analysis-current';
import { analysisJob } from './analysis-status';
import type { BackgroundJob } from './AIActivity';

const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222';
it('retains a checked analysis when an internal link is inserted, extended, or removed', () => {
  const original = newNote('local', 'Ownership über Projekte und Prozesse.');
  const linked = reviseNote(original, {
    content: `[Ownership über Projekte und Prozesse](notes/${a}?type=context).`,
  });
  const extended = reviseNote(linked, {
    content: `[Ownership über Projekte und Prozesse](notes/${a}?type=context&also=${b}:theory).`,
  });
  expect(currentAnalysis(linked, original.revision)).toBe(true);
  expect(currentAnalysis(extended, original.revision)).toBe(true);
  expect(currentAnalysis(reviseNote(extended, { content: original.content }), linked.revision)).toBe(true);
  // Other operations still require the exact source version.
  expect(currentContent(linked, original.revision)).toBe(false);
});
it('invalidates actual changes to words, tags, attachments, external URLs, and code', () => {
  const note = newNote(
    'local',
    `Ownership [Artikel](attachments/${a}.pdf) #konzeption\n[Quelle](https://example.org/a)`,
  );
  for (const content of [
    note.content.replace('Ownership', 'Delegation'),
    note.content.replace('#konzeption', '#team'),
    note.content.replace(`${a}.pdf`, `${b}.pdf`),
    note.content.replace('example.org/a', 'example.org/b'),
    note.content + `\n\n[Neue Quelle](attachments/${b}.pdf)`,
  ])
    expect(currentAnalysis(reviseNote(note, { content }), note.revision)).toBe(false);
  const code = newNote('local', `\`[Ownership](notes/${a})\``);
  expect(analysisContent(code.content)).toBe(code.content);
  expect(currentAnalysis(reviseNote(code, { content: code.content.replace(a, b) }), code.revision)).toBe(
    false,
  );
});
it('does not treat a changed link label as the same content or trust unknown historical revisions', () => {
  const note = newNote('local', 'Ownership im Team');
  expect(
    currentAnalysis(reviseNote(note, { content: `[Delegation](notes/${a}) im Team` }), note.revision),
  ).toBe(false);
  expect(currentAnalysis({ ...note, history: [] }, a)).toBe(false);
});
it('keeps analysis current after removing a separate KI instruction', () => {
  const note = newNote('local', 'Ownership im Team\n\n/ki Gibt es Führungskonzepte?');
  expect(currentAnalysis(reviseNote(note, { content: 'Ownership im Team' }), note.revision)).toBe(true);
});
it('shows the latest relevant analysis job and never an old failure after a completed retry', () => {
  const note = newNote('local', 'Ownership im Team');
  const job: BackgroundJob = {
    id: a,
    note_id: note.id,
    revision: note.revision,
    kind: 'analysis',
    status: 'failed',
    error: 'Zeitlimit',
    created_at: '2026-10-06T10:00:00Z',
  };
  expect(analysisJob(note, [job])?.status).toBe('failed');
  for (const status of ['pending', 'running', 'done']) {
    const retry = { ...job, id: b, status, created_at: '2026-10-06T11:00:00Z' };
    expect(analysisJob(note, [job, retry])?.status).toBe(status === 'done' ? undefined : status);
  }
  expect(analysisJob(reviseNote(note, { content: 'Ganz anderer Inhalt' }), [job])).toBeUndefined();
  expect(analysisJob(note, [{ ...job, kind: 'relations' }])).toBeUndefined();
  expect(analysisJob(note, [{ ...job, note_id: b }])).toBeUndefined();
});
