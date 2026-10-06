// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db, repo } from './repository';
import { createDocument, documentPages } from './document-store';
import { config, extract, knowledge } from './intelligence';

const mock = vi.hoisted(() => ({ api: vi.fn(), getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./cloud', () => ({
  fetchAttachment: (scope: string, id: string) => repo.attachment(scope, id),
  cloud: () => ({ functions: { invoke: mock.api } }),
  ownBackend: () => false,
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mock.getDocument }));
beforeEach(async () => {
  localStorage.clear();
  await Promise.all([db.notes.clear(), db.knowledge.clear(), db.attachments.clear()]);
  vi.clearAllMocks();
  localStorage.setItem('notto-ai:local', JSON.stringify({ ...config('local'), enabled: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cGFnZQ==');
  mock.api.mockImplementation(async () => ({
    data: {
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: `Erkannter Text ${mock.api.mock.calls.length}` }] }],
    },
    error: null,
  }));
});
afterEach(() => vi.restoreAllMocks());
async function pdf(count = 7, nativePages: number[] = []) {
  mock.getPage.mockImplementation(async (number: number) => ({
    getTextContent: async () => ({
      items: nativePages.includes(number) ? [{ str: `PDF-Text ${number}`, hasEOL: true }] : [],
    }),
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  }));
  mock.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: count, getPage: mock.getPage }),
    destroy: mock.destroy,
  }));
  const bytes = new TextEncoder().encode('%PDF-1.7\nscan');
  const markdown = await repo.addPdf('local', {
    name: 'Scan.pdf',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File);
  const id = markdown.match(/attachments\/([^)]*)/)![1];
  const attachment = (await repo.attachment('local', id))!;
  return createDocument('local', attachment);
}
it('reads long scans in resumable batches, preserves every page and never charges completed pages again', async () => {
  const note = await pdf();
  const progress = vi.fn();
  expect(await extract(note, note.document!.attachmentId, true, { onProgress: progress })).toEqual({
    processed: 5,
    remaining: 2,
  });
  expect(progress).toHaveBeenLastCalledWith({ page: 5, total: 7, processed: 5 });
  const pages = await documentPages(note);
  expect(pages).toHaveLength(7);
  expect(pages[4]).toMatchObject({ page: 5, text: 'Erkannter Text 5' });
  expect(pages[5].text).toContain('Kein Text erkannt');
  expect(await extract(note, note.document!.attachmentId, true)).toEqual({ processed: 2, remaining: 0 });
  expect(await extract(note, note.document!.attachmentId, true)).toEqual({ processed: 0, remaining: 0 });
  await extract(note, note.document!.attachmentId);
  expect(mock.api).toHaveBeenCalledTimes(7);
  expect((await documentPages(note)).every((page) => page.text.startsWith('Erkannter Text'))).toBe(true);
  expect(mock.destroy).toHaveBeenCalledTimes(4);
});
it('keeps completed OCR pages after an API failure and resumes only the missing pages', async () => {
  const note = await pdf(3);
  mock.api.mockResolvedValueOnce({
    data: {
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'Bereits erkannte erste Seite' }] }],
    },
    error: null,
  });
  mock.api.mockRejectedValueOnce(new Error('Verbindung unterbrochen'));
  await expect(extract(note, note.document!.attachmentId, true)).rejects.toThrow('Verbindung unterbrochen');
  expect((await documentPages(note))[0].text).toBe('Bereits erkannte erste Seite');
  expect(await extract(note, note.document!.attachmentId, true)).toEqual({ processed: 2, remaining: 0 });
  expect(mock.api).toHaveBeenCalledTimes(4);
  expect((await documentPages(note))[0].text).toBe('Bereits erkannte erste Seite');
});
it('sends only scanned pages to OpenAI and keeps native PDF text unchanged', async () => {
  const note = await pdf(3, [1, 3]);
  expect(await extract(note, note.document!.attachmentId, true)).toEqual({ processed: 1, remaining: 0 });
  expect(mock.api).toHaveBeenCalledTimes(1);
  expect((await documentPages(note)).map((page) => page.text)).toEqual([
    'PDF-Text 1',
    'Erkannter Text 1',
    'PDF-Text 3',
  ]);
  const payload = mock.api.mock.calls[0][1].body.body;
  expect(payload.memory).toBe(false);
  expect(payload.input[0].content[1].type).toBe('input_image');
});
it('stops further requests and discards in-flight OCR text when the source is excluded', async () => {
  const note = await pdf(3);
  mock.api.mockImplementationOnce(async () => {
    localStorage.setItem('notto-ai:local', JSON.stringify({ ...config('local'), excludedNotes: [note.id] }));
    return {
      data: { output: [{ content: [{ type: 'output_text', text: 'Nicht mehr freigegeben' }] }] },
      error: null,
    };
  });
  await expect(extract(note, note.document!.attachmentId, true)).rejects.toThrow('ausgeschlossen');
  expect(mock.api).toHaveBeenCalledTimes(1);
  const records = await knowledge.list('local');
  expect(JSON.stringify(records)).not.toContain('Nicht mehr freigegeben');
});
