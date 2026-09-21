import { expect, it } from 'vitest';
import { imageLayout, noteImages, updateImageLayout } from './image-layout';
import { attachmentIds, excerptOf } from './domain';

it('keeps image layout with the note and preserves attachment references and surrounding text', () => {
  const text = '## Rezepte\n![Rezept](attachments/abc-123.png)\nText';
  const image = noteImages(text)[0];
  const updated = updateImageLayout(text, image.start, 50, true);
  expect(noteImages(updated)[0]).toMatchObject({ width: 50, thumbnail: true });
  expect(attachmentIds(updated)).toEqual(['abc-123.png']);
  expect(updated.startsWith('## Rezepte\n')).toBe(true);
  expect(updated.endsWith('\nText')).toBe(true);
  expect(noteImages(updateImageLayout(updated, image.start, 75, false))[0]).toMatchObject({
    width: 75,
    thumbnail: false,
  });
  expect(imageLayout('noto:width=900;mode=inline').width).toBe(100);
});
it('does not treat code examples as attached images', () => {
  expect(noteImages('```md\n![Bild](attachments/abc.png)\n```')).toHaveLength(0);
});
it('omits the derived title from the excerpt while retaining the body', () => {
  expect(excerptOf('## Cocktails\n\nEin Rezept')).toBe('Ein Rezept');
  expect(excerptOf('#thema\nMeine Notiz\nGedanken')).not.toContain('Meine Notiz');
  expect(excerptOf('## Einziger Titel')).toBe('');
});
