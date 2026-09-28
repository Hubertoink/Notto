import { beforeEach, expect, it, vi } from 'vitest';
import { openai } from './openai';
import { verifiedResearch } from './command-verification';
import type { Database } from './database';

vi.mock('./openai', () => ({ openai: vi.fn() }));
const plan = {
  objective: 'Fünf weitere kommunikative Spiele empfehlen',
  requestedCount: 5,
  criteria: ['einfach zu erlernen', 'ab 12 Jahren', 'kommunikativ'],
  excludedExamples: ['Bluff', 'Beasty Bar', 'Challengers!'],
};
const job = {
  user_id: 'test',
  model: 'test',
  prompt: 'Gib mir fünf weitere ähnliche Spiele für Jugendliche ab 12.',
  note_content: 'Bluff, Beasty Bar, Challengers!',
};
const original = {
  text: 'Vergleich der drei Spiele',
  summary: 'Recherche',
  partial: false,
  sources: [{ title: 'Regeln', url: 'https://example.com/rules' }],
  queries: ['Spiele'],
};
const json = (value: unknown) => ({
  status: 'completed',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
});
const good = {
  fulfilled: true,
  deliveredItems: ['Just One', 'Top Ten', 'So Kleever', 'Wavelength', 'Dixit'],
  issues: [],
};
beforeEach(() => vi.mocked(openai).mockReset());

it('rejects the three-example comparison even when the reviewer incorrectly approves it, then researches again', async () => {
  vi.mocked(openai)
    .mockResolvedValueOnce(json(plan))
    .mockResolvedValueOnce(json({ fulfilled: true, deliveredItems: plan.excludedExamples, issues: [] }))
    .mockResolvedValueOnce(json(good));
  const repaired = { ...original, text: good.deliveredItems.join(', ') };
  const research = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(repaired);
  const stages: string[] = [];
  const result = await verifiedResearch(
    {} as Database,
    { models: [] },
    job,
    [],
    new AbortController().signal,
    research,
    async (stage) => {
      stages.push(stage);
    },
  );
  expect(research).toHaveBeenCalledTimes(2);
  expect(research.mock.calls[1][1].join(' ')).toContain('Gefordert: 5');
  expect(research.mock.calls[1][1].join(' ')).toContain('Vorhandene Beispiele');
  expect(research.mock.calls[1][2]).toEqual(original);
  expect(result).toMatchObject({ text: repaired.text, partial: false });
  expect(stages).toContain('Ergebnis wird am Originalauftrag geprüft');
  for (const call of vi.mocked(openai).mock.calls) {
    expect(call[3]).toMatchObject({ purpose: 'note_command', memory: false });
    expect(JSON.parse(call[3].input as string)).toMatchObject({
      auftrag: job.prompt,
      notiz: job.note_content,
    });
  }
});

it('keeps unresolved criteria visible as a partial result after two repairs', async () => {
  vi.mocked(openai)
    .mockResolvedValueOnce(json(plan))
    .mockResolvedValue(json({ ...good, fulfilled: false, issues: ['Eignung ab 12 Jahren nicht belegt.'] }));
  const research = vi.fn().mockResolvedValue(original);
  const warnings: string[] = [];
  const result = await verifiedResearch(
    {} as Database,
    { models: [] },
    job,
    warnings,
    new AbortController().signal,
    research,
  );
  expect(research).toHaveBeenCalledTimes(3);
  expect(result.partial).toBe(true);
  expect(result.summary).toContain('Eignung ab 12 Jahren nicht belegt');
  expect(warnings).toContain('Eignung ab 12 Jahren nicht belegt.');
});

it('never marks an unreviewed answer complete when verification fails', async () => {
  vi.mocked(openai).mockResolvedValueOnce(json(plan)).mockRejectedValueOnce(new Error('API unavailable'));
  const result = await verifiedResearch(
    {} as Database,
    { models: [] },
    job,
    [],
    new AbortController().signal,
    async () => original,
  );
  expect(result.partial).toBe(true);
  expect(result.summary).toContain('Ergebnisprüfung konnte nicht abgeschlossen');
});

it('propagates cancellation instead of publishing an unchecked draft', async () => {
  vi.mocked(openai).mockResolvedValueOnce(json(plan));
  const controller = new AbortController();
  await expect(
    verifiedResearch({} as Database, { models: [] }, job, [], controller.signal, async () => {
      controller.abort(new Error('Auftrag abgebrochen'));
      throw controller.signal.reason;
    }),
  ).rejects.toThrow('Auftrag abgebrochen');
});
