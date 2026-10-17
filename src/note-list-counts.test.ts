import { expect, it } from 'vitest';
import { newNote } from './domain';
import { noteListCounts } from './note-list-counts';

it('counts library documents and embedded files once across notes', () => {
  const source = {
    ...newNote('local', '[Konzept](attachments/abc.pdf)'),
    document: { attachmentId: 'abc.pdf', name: 'Konzept', mime: 'application/pdf', version: 1 },
  };
  const note = newNote('local', '[Konzept](attachments/abc.pdf)\n[Text](attachments/def.docx)');
  const another = newNote(
    'local',
    '[Text](attachments/def.docx)\n[Protokoll](attachments/a0.txt)\n[Plan](attachments/b0.md)',
  );
  expect(noteListCounts([source, note, another])).toEqual({ notes: 2, documents: 4 });
});

it('does not count web sources, images, code examples, unused definitions or old revisions', () => {
  const note = newNote(
    'local',
    '[Quelle](https://example.org/attachments/abc.pdf)\n![Foto](attachments/def.png)\n[Text](https://example.org/artikel)\n\n`[Beispiel](attachments/abc.pdf)`\n\n```md\n[Beispiel](attachments/def.pdf)\n```\n\n[unbenutzt]: attachments/a0.pdf',
  );
  note.history = [{ revision: 'old', savedAt: note.createdAt, content: '[Alt](attachments/aaa.pdf)' }];
  expect(noteListCounts([note])).toEqual({ notes: 1, documents: 0 });
  expect(noteListCounts([])).toEqual({ notes: 0, documents: 0 });
});

it('includes reference-style attachment links and keeps account files distinct', () => {
  const content = '[Quelle][pdf]\n\n[pdf]: attachments/abc.pdf';
  expect(noteListCounts([newNote('a', content), newNote('b', content)])).toEqual({ notes: 2, documents: 2 });
});
