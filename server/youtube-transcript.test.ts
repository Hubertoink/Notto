import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Database } from './database';
import { fetchYoutubeTranscript } from './youtube-fetch';
import {
  youtubeTranscript,
  transcriptSource,
  transcriptCitation,
  noteTranscripts,
  type YoutubeTranscript,
} from './youtube-transcript';
vi.mock('./youtube-fetch', () => ({ fetchYoutubeTranscript: vi.fn() }));
const pg = new PGlite();
const db = { query: (sql: string, args: unknown[]) => pg.query(sql, args) } as unknown as Database;
const alice = '11111111-1111-4111-8111-111111111111',
  bob = '22222222-2222-4222-8222-222222222222';
const url = 'https://youtu.be/qp0HIF3SfI4';
const fixture: YoutubeTranscript = {
  videoId: 'qp0HIF3SfI4',
  title: 'Lernbüro',
  automatic: true,
  fetchedAt: '2026-10-09T12:00:00Z',
  segments: [
    { text: 'Lernende setzen sich Ziele.', offset: 0, duration: 5, lang: 'de' },
    { text: 'Sie prüfen ihren Fortschritt.', offset: 12.5, duration: 4, lang: 'de' },
    { text: 'Ein anderer Gedanke.', offset: 120, duration: 3, lang: 'de' },
  ],
};
beforeAll(async () => {
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const user of [alice, bob])
    await pg.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      user,
      `${user}@test.invalid`,
      'unused',
    ]);
});
beforeEach(async () => {
  await pg.exec('DELETE FROM youtube_transcript_cache');
  vi.mocked(fetchYoutubeTranscript).mockReset().mockResolvedValue(fixture);
});
afterAll(() => pg.close());
it('persists transcripts by video and account, across URL formats, with expiry', async () => {
  await youtubeTranscript(db, alice, url);
  await youtubeTranscript(db, alice, 'https://www.youtube.com/watch?v=qp0HIF3SfI4&t=90');
  expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(1);
  await youtubeTranscript(db, bob, url);
  expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(2);
  await pg.query(
    "UPDATE youtube_transcript_cache SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [alice],
  );
  await youtubeTranscript(db, alice, url);
  expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(3);
});
it('shares concurrent fetches and retains full captions in cache', async () => {
  const results = await Promise.all([youtubeTranscript(db, alice, url), youtubeTranscript(db, alice, url)]);
  expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(1);
  expect(results[0].segments).toHaveLength(3);
  const source = transcriptSource(results[0], 70);
  expect(source.transcript?.partial).toBe(true);
  expect((await youtubeTranscript(db, alice, url)).segments).toHaveLength(3);
});
it('grounds time links at the first quoted segment, rejecting fabricated or nonadjacent quotes', () => {
  const source = transcriptSource(fixture);
  expect(transcriptCitation(source, 'Sie prüfen ihren Fortschritt.')).toMatchObject({
    start: 12.5,
    language: 'de',
    automatic: true,
  });
  expect(transcriptCitation(source, 'Ziele. Sie prüfen')).toMatchObject({ start: 0 });
  expect(transcriptCitation(source, 'Fortschritt. Ein anderer')).toBeUndefined();
  expect(transcriptCitation(source, 'Erfundene Aussage')).toBeUndefined();
  expect(transcriptCitation(source, '')).toBeUndefined();
});
it('reports missing captions and briefly caches failures without inventing content', async () => {
  vi.mocked(fetchYoutubeTranscript).mockRejectedValue(new Error('Keine Untertitel verfügbar.'));
  const result = await noteTranscripts(db, alice, `${url}\nhttps://www.youtube.com/watch?v=qp0HIF3SfI4`);
  expect(result.sources).toEqual([]);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain('Keine Untertitel');
  await expect(youtubeTranscript(db, alice, url)).rejects.toThrow('Keine Untertitel');
  expect(fetchYoutubeTranscript).toHaveBeenCalledTimes(1);
});
it('does not cache malformed timestamps as usable evidence', async () => {
  vi.mocked(fetchYoutubeTranscript).mockResolvedValue({
    ...fixture,
    segments: [{ ...fixture.segments[0], offset: -1 }],
  });
  await expect(youtubeTranscript(db, alice, url)).rejects.toThrow('keine gültigen');
});
it('does not read video URLs hidden in separate KI commands or cancelled requests', async () => {
  expect((await noteTranscripts(db, alice, `/ki Lies ${url}`)).sources).toEqual([]);
  await expect(youtubeTranscript(db, alice, url, AbortSignal.abort())).rejects.toThrow();
  expect(fetchYoutubeTranscript).not.toHaveBeenCalled();
});
