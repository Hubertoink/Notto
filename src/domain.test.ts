import { describe, expect, it } from 'vitest';
import {
  attachmentIds,
  conflictCopy,
  importedMarkdown,
  markdownFile,
  matchesQuery,
  newNote,
  reviseNote,
  tagsOf,
  titleOf,
  excerptOf,
} from './domain';
describe('original notes', () => {
  it('preserves third-party Markdown frontmatter', () => {
    const text = '---\ntitle: Mein Dokument\n---\n\nOriginal';
    expect(importedMarkdown(text)).toBe(text);
  });
  it('extracts Unicode tags without mistaking headings, URLs or code for tags', () => {
    expect(
      tagsOf(
        '# Überschrift\n#pädagogik #Medien #medien\nhttps://test.de/#kein-tag\n`#code`\n```\n#block\n```',
      ),
    ).toEqual(['pädagogik', 'medien']);
  });
  it('keeps exact original text through Markdown export/import', () => {
    const text = '# Ein Gedanke\n\nAuch  doppelte Leerzeichen.\n#konzept\n';
    const note = newNote('local', text);
    expect(importedMarkdown(markdownFile(note))).toBe(text);
  });
  it('keeps previous text versions when editing and restoring', () => {
    const a = newNote('local', 'Erste Fassung');
    const b = reviseNote(a, { content: 'Zweite Fassung' });
    const c = reviseNote(b, { content: a.content });
    expect(c.history.map((r) => r.content)).toEqual(['Erste Fassung', 'Zweite Fassung', 'Erste Fassung']);
    expect(a.content).toBe('Erste Fassung');
  });
  it('does not invent text revisions for metadata-only changes', () => {
    const a = newNote('local', 'Gedanke');
    expect(reviseNote(a, { pinned: true }).history).toEqual(a.history);
  });
  it('preserves a conflicting deletion as a readable independent copy', () => {
    const note = reviseNote(newNote('local', 'Nicht verlieren'), { deleted: true });
    const copy = conflictCopy(note);
    expect(copy.content).toBe(note.content);
    expect(copy.deleted).toBe(false);
    expect(copy.id).not.toBe(note.id);
    expect(copy.baseRevision).toBeNull();
    expect(copy.conflictOf).toBe(note.id);
  });
  it('combines exact tag filters and phrases', () => {
    const n = newNote('local', '#medien Steam Families auf vier PCs');
    expect(matchesQuery(n, '#medien "vier PCs"')).toBe(true);
    expect(matchesQuery(n, '#medi')).toBe(false);
    expect(matchesQuery(n, 'fünf')).toBe(false);
  });
  it('finds image references and derives a title without changing the source', () => {
    const n = newNote('local', '#medien\nSteam einrichten\n![Bild](attachments/abc-123.png)');
    expect(titleOf(n.content)).toBe('Steam einrichten');
    expect(attachmentIds(n.content)).toEqual(['abc-123.png']);
  });
  it('turns Markdown tables into compact readable list previews', () => {
    expect(
      excerptOf(
        '## Cocktails\n\n| Nr. | Name | Zutaten |\n| --- | --- | --- |\n| 1. | Gin Mule | 4 cl Gin |',
      ),
    ).toContain('Nr. · Name · Zutaten');
    expect(
      excerptOf(
        '## Cocktails\n\n| Nr. | Name | Zutaten |\n| --- | --- | --- |\n| 1. | Gin Mule | 4 cl Gin |',
      ),
    ).not.toContain('| --- |');
  });
});
