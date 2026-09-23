import { expect, it, vi } from 'vitest';
import { newNote } from '../src/domain';
import { sourceTexts } from './sources';
import type { Database } from './database';
const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (path: string, ...args: any[]) =>
      files.has(String(path))
        ? Promise.resolve(files.get(String(path)))
        : (actual.readFile as any)(path, ...args),
  };
});
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 20 80 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = result.length;
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(result);
}
it('extracts actual PDF text before server analysis and persists page provenance', async () => {
  const id = `${crypto.randomUUID()}.pdf`,
    user = crypto.randomUUID();
  const { join } = await import('node:path');
  files.set(join('/test-attachments', user, id), pdf('Atlas has four PCs.'));
  const note = newNote(user, `[Projekt](attachments/${id})`);
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const result = await sourceTexts({ query } as unknown as Database, user, note, [], '/test-attachments');
  expect(result).toHaveLength(2);
  expect(result[1]).toMatchObject({ text: 'Atlas has four PCs.', page: 1, attachment: id, noteId: note.id });
  expect(JSON.parse(query.mock.calls[0][1][2]).kind).toBe('extraction');
  // PDF.js initialization can exceed the default five seconds on a cold Windows runner.
}, 20000);
it('uses the newest extracted attachment and ignores detached attachments', async () => {
  const id = `${crypto.randomUUID()}.pdf`,
    note = newNote('alice', `[Projekt](attachments/${id})`);
  const records = ['old', 'new'].map((text, index) => ({
    kind: 'extraction',
    at: String(index),
    data: { id, pages: [{ noteId: note.id, revision: note.revision, text, attachment: id, page: 1 }] },
  }));
  const result = await sourceTexts({} as Database, 'alice', note, records);
  expect(result[1].text).toBe('new');
  expect(await sourceTexts({} as Database, 'alice', { ...note, content: 'Ohne PDF' }, records)).toHaveLength(
    1,
  );
});
