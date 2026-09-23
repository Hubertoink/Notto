// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, repo } from './repository';
import { newNote, reviseNote, attachmentIds } from './domain';
import { saveMemory, suggestMemory } from './memory-client';
import {
  analyze,
  config,
  cosine,
  decisionKey,
  eligible,
  knowledge,
  latest,
  resolvedDecision,
  saveConfig,
  semanticSearch,
  validateAnswer,
} from './intelligence';
const api = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./cloud', () => ({ cloud: () => ({ functions: { invoke: api } }), fetchAttachment: vi.fn() }));
beforeEach(async () => {
  localStorage.clear();
  api.mockReset();
  await Promise.all([db.notes.clear(), db.knowledge.clear(), db.attachments.clear()]);
  saveConfig('local', { ...config('local'), enabled: true });
});
const item = {
  kind: 'task' as const,
  title: 'Steam Families einrichten',
  detail: 'Vier PCs',
  quote: 'Steam Families für vier PCs einrichten',
};
const response = (suggestions: unknown[]) => ({
  data: {
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ suggestions }) }] }],
  },
  error: null,
});
it('includes saved personal instructions and forgets them without changing a note', async () => {
  const note = newNote('local', item.quote);
  await repo.put(note, null);
  const memory = {
    key: 'instruction',
    category: 'instruction' as const,
    text: 'Antworte knapp und sachlich.',
    status: 'active' as const,
    sources: [],
  };
  await saveMemory('local', memory);
  api.mockResolvedValue(response([item]));
  await analyze(note);
  expect(api.mock.calls[0][1].body.body.instructions).toContain(memory.text);
  await saveMemory('local', { ...memory, status: 'forgotten', text: '' });
  await analyze(note);
  expect(api.mock.calls[1][1].body.body.instructions).not.toContain(memory.text);
  expect(await repo.get('local', note.id)).toEqual(note);
});
it('requires exact evidence for memory proposals and never accepts them automatically', async () => {
  const note = newNote('local', item.quote);
  await repo.put(note, null);
  const factsResponse = (quote: string) => ({
    data: {
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ facts: [{ text: 'Vier PCs im Projekt', quote }] }),
            },
          ],
        },
      ],
    },
    error: null,
  });
  api.mockResolvedValue(factsResponse('Erfundener Beleg'));
  await expect(suggestMemory(note)).rejects.toThrow('Quellenbeleg');
  expect(await knowledge.list('local')).toHaveLength(0);
  api.mockResolvedValue(factsResponse(item.quote));
  expect(await suggestMemory(note)).toBe(1);
  const saved = (await knowledge.list('local'))[0].data as import('./memory-policy').Memory;
  expect(saved.status).toBe('suggested');
  await saveMemory('local', { ...saved, status: 'forgotten', text: '' });
  expect(await suggestMemory(note)).toBe(0);
  expect(await repo.get('local', note.id)).toEqual(note);
});
it('stores analysis separately without changing original text, revision, or history', async () => {
  const note = newNote('local', `#medien\n${item.quote}`);
  await repo.put(note, null);
  api.mockResolvedValue(response([item]));
  await analyze(note);
  expect(await repo.get('local', note.id)).toEqual(note);
  expect((await knowledge.list('local'))[0].kind).toBe('analysis');
  const body = api.mock.calls[0][1].body.body;
  expect(body.store).toBe(false);
  expect(body.text.format.strict).toBe(true);
});
it('rejects invented evidence and does not write analysis', async () => {
  const note = newNote('local', 'Konzept für ein Jugendhaus');
  await repo.put(note, null);
  api.mockResolvedValue(response([item]));
  await expect(analyze(note)).rejects.toThrow('Beleg');
  expect(await knowledge.list('local')).toHaveLength(0);
});
it('accepts PDF reading notes only when the quote occurs on an extracted PDF page', async () => {
  const id = `${crypto.randomUUID()}.pdf`;
  const note = newNote('local', `Artikel für die Jugendarbeit\n[Artikel](attachments/${id})`);
  await repo.put(note, null);
  await knowledge.append(note, 'extraction', {
    id,
    pages: [
      {
        noteId: note.id,
        revision: note.revision,
        attachment: id,
        page: 2,
        text: 'Beteiligung stärkt Zugehörigkeit.',
      },
    ],
    ocr: false,
  });
  const insight = {
    kind: 'insight',
    title: 'Beteiligung vertiefen',
    detail: 'Wie lässt sich das in der Jugendarbeit erproben?',
    quote: 'Beteiligung stärkt Zugehörigkeit.',
  };
  api.mockResolvedValue(response([insight]));
  await analyze(note);
  expect((await knowledge.list('local')).find((record) => record.kind === 'analysis')?.data).toEqual({
    suggestions: [insight],
  });
  api.mockResolvedValue(response([{ ...insight, quote: 'Artikel für die Jugendarbeit' }]));
  await expect(analyze(note)).rejects.toThrow('Beleg');
});
it('discards a response if the user changes the note during analysis', async () => {
  const note = newNote('local', item.quote);
  await repo.put(note, null);
  api.mockImplementation(async () => {
    await repo.put(reviseNote(note, { content: 'Plan geändert' }), note.revision);
    return response([item]);
  });
  await analyze(note);
  expect(await knowledge.list('local')).toHaveLength(0);
});
it('preserves user correction and completion across re-analysis', async () => {
  const note = newNote('local', item.quote);
  await repo.put(note, null);
  await knowledge.append(note, 'decision', {
    key: decisionKey(note.id, item),
    status: 'done',
    title: 'Vier PCs eingerichtet',
    detail: 'Von mir geprüft',
  });
  api.mockResolvedValue(response([{ ...item, title: 'Steam einrichten' }]));
  await analyze(note);
  const records = await knowledge.list('local');
  expect(latest(records, 'analysis', note)).toBeDefined();
  expect(resolvedDecision(records, decisionKey(note.id, item))).toMatchObject({
    status: 'done',
    title: 'Vier PCs eingerichtet',
  });
  expect(await knowledge.list('someone-else')).toHaveLength(0);
});
it('never sends excluded or deleted notes', async () => {
  const note = newNote('local', `#privat ${item.quote}`);
  expect(eligible(note)).toBe(false);
  await expect(analyze(note)).rejects.toThrow('Tag #privat');
  expect(api).not.toHaveBeenCalled();
  expect(eligible({ ...note, content: 'normal', deleted: true })).toBe(false);
});
it('validates answer citations and refuses unsupported answers', () => {
  const sources = [{ noteId: 'one', revision: 'v1', text: 'Vier PCs stehen im Medienraum.' }];
  expect(
    validateAnswer({ answer: 'Vier PCs', citations: [{ index: 0, quote: 'Vier PCs' }] }, sources).answer,
  ).toBe('Vier PCs');
  expect(() =>
    validateAnswer({ answer: 'Fünf', citations: [{ index: 0, quote: 'Fünf PCs' }] }, sources),
  ).toThrow();
  expect(() =>
    validateAnswer({ answer: 'Vier', citations: [{ index: 4, quote: 'Vier' }] }, sources),
  ).toThrow();
  expect(validateAnswer({ answer: 'Erfunden', citations: [] }, sources).answer).toContain(
    'keine ausreichend belegte',
  );
});
it('batches embeddings and reuses cached vectors without changing notes', async () => {
  const a = newNote('local', 'Medienraum vier PCs'),
    b = newNote('local', 'Gemeinschaft und Konzept');
  await repo.put(a, null);
  await repo.put(b, null);
  api.mockImplementation(async (_name, arg) => {
    const input = arg.body.body.input;
    return {
      data: {
        data: Array.isArray(input)
          ? input.map((_, index) => ({ index, embedding: index === 0 ? [1, 0] : [0, 1] }))
          : [{ index: 0, embedding: [1, 0] }],
      },
      error: null,
    };
  });
  expect((await semanticSearch('local', 'Computer', [a, b]))[0].noteId).toBe(a.id);
  expect(api).toHaveBeenCalledTimes(2);
  await semanticSearch('local', 'Technologie', [a, b]);
  expect(api).toHaveBeenCalledTimes(3);
  expect(await repo.get('local', a.id)).toEqual(a);
  expect(cosine([1, 0], [0, 1])).toBe(0);
  expect(cosine([0, 0], [0, 0])).toBe(0);
});
it('accepts real PDF signatures and includes PDF references in attachment tracking', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\nexample');
  const file = { name: 'Plan.pdf', size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
  const markdown = await repo.addPdf('local', file);
  const id = attachmentIds(markdown)[0];
  expect(id.endsWith('.pdf')).toBe(true);
  expect((await repo.attachment('local', id))?.bytes).toEqual(bytes);
  await expect(
    repo.addPdf('local', {
      ...file,
      arrayBuffer: async () => new TextEncoder().encode('not pdf').buffer,
    } as File),
  ).rejects.toThrow('kein gültiges PDF');
});
