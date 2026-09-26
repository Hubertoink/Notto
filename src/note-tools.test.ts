import { expect, it } from 'vitest';
import { newNote, reviseNote, validNote, markdownFile } from './domain';
import {
  backlinks,
  linkedNotes,
  noteLink,
  noteReferenceIds,
  formatText,
  markdownTasks,
  normalizeCollections,
  toggleMarkdownTask,
} from './note-tools';
import { noteLinkHref } from './note-links';

it('links by identity across renames and excludes other accounts and deleted notes', () => {
  const target = newNote('alice', 'Unsere Grundsätze');
  const source = newNote('alice', `Siehe ${noteLink(target)}.`);
  const renamed = reviseNote(target, { content: 'Neue Grundsätze' });
  expect(linkedNotes(source.content, [renamed], 'alice')).toEqual([renamed]);
  expect(
    backlinks(renamed, [
      source,
      { ...source, id: crypto.randomUUID(), scope: 'bob' },
      { ...source, id: crypto.randomUUID(), deleted: true },
    ]),
  ).toEqual([source]);
  expect(linkedNotes(source.content, [{ ...renamed, deleted: true }], 'alice')).toEqual([]);
  expect(linkedNotes(source.content, [renamed], 'bob')).toEqual([]);
});

it('ignores examples in code and images when finding backlinks', () => {
  const note = newNote('local', 'Titel [mit Klammern]');
  const link = noteLink(note);
  expect(noteReferenceIds(`${link}\n${link}`)).toEqual([note.id]);
  expect(noteReferenceIds(`\`${link}\`\n\`\`\`md\n${link}\n\`\`\`\n~~~\n${link}\n~~~\n!${link}`)).toEqual([]);
});

it('finds every target stored behind the same visible term', () => {
  const first = newNote('local', 'Erstes Ziel');
  const second = newNote('local', 'Zweites Ziel');
  const href = noteLinkHref([{ id: first.id }, { id: second.id, relation: 'context' }]);
  expect(noteReferenceIds(`[Gemeinsamer Begriff](${href})`)).toEqual([first.id, second.id]);
});

it('toggles the selected Markdown task while ignoring code examples', () => {
  const content =
    '- [ ] Erste Aufgabe\n- [x] Zweite Aufgabe\n\n```md\n- [ ] Nur ein Beispiel\n```\n\n    - [ ] Codeblock';
  expect(markdownTasks(content).map((task) => [task.label, task.checked])).toEqual([
    ['Erste Aufgabe', false],
    ['Zweite Aufgabe', true],
  ]);
  expect(toggleMarkdownTask(content, 1, false)).toContain('- [ ] Zweite Aufgabe');
  expect(toggleMarkdownTask(content, 0, true)).toContain('- [x] Erste Aufgabe');
});

it('formats selections and removes formatting without losing surrounding text', () => {
  const bold = formatText('Hallo Welt!', 6, 10, 'bold');
  expect(bold).toEqual({ text: 'Hallo **Welt**!', start: 8, end: 12 });
  expect(formatText(bold.text, bold.start, bold.end, 'bold').text).toBe('Hallo Welt!');
  expect(formatText('eins\nzwei\ndrei', 0, 10, 'number').text).toBe('1. eins\n2. zwei\ndrei');
  expect(formatText('Titel\nText', 0, 0, 'heading').text).toBe('## Titel\nText');
  const link = formatText('Quelle', 0, 6, 'link');
  expect(link.text.slice(link.start, link.end)).toBe('https://');
});

it('inserts a table without losing selected lines or surrounding text', () => {
  const result = formatText('Vorher\nGin | Lime\nRum\nNachher', 7, 21, 'table');
  expect(result.text).toContain('Vorher');
  expect(result.text).toContain('Nachher');
  expect(result.text).toContain('Gin &#124; Lime');
  expect(result.text).toContain('| --- | --- |');
  expect(result.text.slice(result.start, result.end)).toBe('Bezeichnung');
});

it('preserves and validates collection metadata without inventing text history', () => {
  const note = newNote('local', 'Gedanke');
  const collections = normalizeCollections([' Jugendhaus ', 'jugendhaus', 'Medien   Workshop']);
  expect(collections).toEqual(['Jugendhaus', 'Medien Workshop']);
  const updated = reviseNote(note, { collections });
  expect(updated.history).toEqual(note.history);
  expect(validNote(updated)).toBe(true);
  expect(validNote({ ...note, collections: [7] })).toBe(false);
  expect(markdownFile(updated)).toContain('collections: ["Jugendhaus","Medien Workshop"]');
});
