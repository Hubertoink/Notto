import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { documentText } from './document-text';

it('reads paragraphs, tables, tabs, breaks and entities from DOCX without embedded objects', () => {
  const bytes = zipSync({
    'word/document.xml': strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Beteiligung &amp; Offenheit</w:t><w:tab/><w:t>&#x1F44B;</w:t><w:br/><w:t>Jugendhaus</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Team</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    ),
    'word/embeddings/ignored.bin': strToU8('must not appear'),
  });
  expect(documentText('source.docx', bytes)).toBe('Beteiligung & Offenheit\t👋\nJugendhaus\nTeam');
});
it('reads Unicode text and Markdown and rejects disguised binary files', () => {
  expect(documentText('source.md', strToU8('\uFEFF# Konzeption\nJugendliche wählen mit.'))).toContain(
    'Jugendliche wählen mit.',
  );
  expect(() => documentText('source.txt', new Uint8Array([255, 255]))).toThrow();
  expect(() => documentText('source.txt', new Uint8Array([0, 1]))).toThrow('UTF-8');
  expect(() => documentText('source.docx', zipSync({ 'other.xml': strToU8('No content') }))).toThrow('DOCX');
});
it('rejects oversized decompressed DOCX text before allocating it', () => {
  const bytes = zipSync({ 'word/document.xml': new Uint8Array(17 * 1024 * 1024) });
  expect(() => documentText('source.docx', bytes)).toThrow('entpackte');
});
