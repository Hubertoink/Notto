// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { topicGroups } from './Topics';
import { newNote } from './domain';
import { attachmentTitle } from './AttachmentTitle';
it('uses hashtags directly without duplicating AI suggestions', () => {
  const note = newNote('local', '#medien Gemeinschaft erleben');
  const groups = topicGroups(
    [note],
    [
      {
        id: 'analysis',
        scope: note.scope,
        noteId: note.id,
        revision: note.revision,
        kind: 'analysis',
        at: new Date().toISOString(),
        data: {
          suggestions: [
            { kind: 'topic', title: 'Medien', detail: '', quote: '#medien' },
            { kind: 'topic', title: 'Gemeinschaft', detail: '', quote: 'Gemeinschaft erleben' },
          ],
        },
      },
    ],
  );
  expect(groups.map((g) => [g.title, g.ai])).toEqual([
    ['#medien', false],
    ['Gemeinschaft', true],
  ]);
  expect(groups[0].notes.size).toBe(1);
});
it('uses the descriptive PDF link label instead of an opaque attachment ID', () => {
  expect(attachmentTitle('[Spiegel_Konzeptionen_entwickeln.pdf](attachments/abc.pdf)', 'abc.pdf')).toBe(
    'Spiegel_Konzeptionen_entwickeln.pdf',
  );
});
