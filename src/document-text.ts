import { unzipSync, strFromU8 } from 'fflate';

export const documentMimes: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};
export const isTextDocument = (id: string) => /\.(docx|txt|md)$/.test(id);
const maxTextBytes = 16 * 1024 * 1024;

function xmlText(xml: string) {
  return xml
    .replace(/<w:tab\b[^>]*\/?\s*>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/g, '\n')
    .replace(/<\/w:p\s*>/g, '\n')
    .replace(/<\/w:tc\s*>/g, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (!entity.startsWith('#')) return named[entity] ?? '';
      const number = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    })
    .trim();
}

/** Text extraction only; never executes macros, embedded objects, or external links. */
export function documentText(id: string, bytes: Uint8Array): string {
  if (bytes.length > 12 * 1024 * 1024) throw new Error('Eine Datei darf höchstens 12 MB groß sein.');
  if (id.endsWith('.docx')) {
    let oversized = false;
    const files = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name !== 'word/document.xml') return false;
        if (entry.originalSize > maxTextBytes) {
          oversized = true;
          return false;
        }
        return true;
      },
    });
    if (oversized) throw new Error('Der entpackte Dokumenttext ist zu groß. Bitte das Dokument aufteilen.');
    const xml = files['word/document.xml'];
    if (!xml)
      throw new Error('Kein lesbares DOCX-Dokument. Bitte eine unverschlüsselte DOCX-Datei verwenden.');
    return xmlText(strFromU8(xml));
  }
  if (!/\.(txt|md)$/.test(id)) throw new Error('Nicht unterstütztes Dokumentformat.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('Bitte eine UTF-8-Textdatei auswählen.');
  return text.trim();
}
