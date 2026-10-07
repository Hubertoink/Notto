import { beforeEach, expect, it, vi } from 'vitest';
import type { Database } from './database';
import { readWholeDocuments } from './document-reader';
const api = vi.hoisted(() => vi.fn());
vi.mock('./openai', () => ({ openai: api }));
beforeEach(() => api.mockReset());
const response = (quote: string) => ({
  status: 'completed',
  output: [
    {
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({
            findings: [{ source: 0, quote, detail: 'Belegtes Teilergebnis' }],
            insufficient: false,
          }),
        },
      ],
    },
  ],
});
const source = (page: number, text: string) => ({
  noteId: 'n',
  revision: 'r',
  title: 'Quelle',
  attachment: 'a.pdf',
  page,
  text,
});
const env = { models: ['test'] };

it('reads every batch before returning original evidence for synthesis', async () => {
  api
    .mockResolvedValueOnce(response('Erste Anforderung.'))
    .mockResolvedValueOnce(response('Letzte Einschränkung.'));
  const progress = vi.fn(async () => {});
  const result = await readWholeDocuments(
    {} as Database,
    env,
    'alice',
    'test',
    'Prüfe alle Anforderungen',
    [[source(1, 'Erste Anforderung.')], [source(90, 'Letzte Einschränkung.')]],
    new AbortController().signal,
    progress,
  );
  expect(api).toHaveBeenCalledTimes(2);
  expect(result.sources.map((s) => s.page)).toEqual([1, 90]);
  expect(result.notes.map((s) => s.source)).toEqual([0, 1]);
  expect(result.sources[1].text).toBe('Letzte Einschränkung.');
});

it('rejects invented citations and propagates cancellation before sending text', async () => {
  api.mockResolvedValue(response('Erfundener Text'));
  await expect(
    readWholeDocuments(
      {} as Database,
      env,
      'alice',
      'test',
      'Zusammenfassen',
      [[source(1, 'Original')]],
      new AbortController().signal,
      async () => {},
    ),
  ).rejects.toThrow('Originalbeleg');
  api.mockClear();
  const controller = new AbortController();
  controller.abort(new Error('Abgebrochen'));
  await expect(
    readWholeDocuments(
      {} as Database,
      env,
      'alice',
      'test',
      'Zusammenfassen',
      [[source(1, 'Original')]],
      controller.signal,
      async () => {},
    ),
  ).rejects.toThrow('Abgebrochen');
  expect(api).not.toHaveBeenCalled();
});
