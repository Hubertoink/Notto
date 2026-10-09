import { z } from 'zod';
import type { Database } from './database.js';
import type { BrowserSource } from './command-browser.js';
import { youtubeVideoId, youtubeUrl, transcriptTime, type TranscriptCitation } from '../src/youtube.js';
import { commandUrls, withoutNoteCommands } from '../src/note-command.js';
import { fetchYoutubeTranscript } from './youtube-fetch.js';

const segmentSchema = z.object({
  text: z.string().min(1).max(10000),
  offset: z.number().finite().min(0).max(86400),
  duration: z.number().finite().min(0).max(86400),
  lang: z.string().min(1).max(50),
});
const transcriptSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(500),
  automatic: z.boolean(),
  fetchedAt: z.string(),
  segments: z.array(segmentSchema).min(1).max(12000),
});
export type YoutubeTranscript = z.infer<typeof transcriptSchema>;
const normal = (text: string) => text.replace(/\s+/g, ' ').trim();
const inFlight = new WeakMap<Database, Map<string, Promise<YoutubeTranscript>>>();

export async function youtubeTranscript(db: Database, user: string, url: string, parentSignal?: AbortSignal) {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('Ungültiger YouTube-Videolink.');
  parentSignal?.throwIfAborted();
  const cached = (
    await db.query(
      'SELECT document FROM youtube_transcript_cache WHERE user_id=$1 AND video_id=$2 AND expires_at>now()',
      [user, videoId],
    )
  ).rows[0]?.document;
  if (cached?.error) throw new Error(cached.error);
  const parsed = transcriptSchema.safeParse(cached);
  if (parsed.success && parsed.data.videoId === videoId) return parsed.data;
  let pending = inFlight.get(db);
  if (!pending) {
    pending = new Map();
    inFlight.set(db, pending);
  }
  const key = `${user}:${videoId}`;
  // A cancelled caller must not cancel another caller's shared download.
  let work = pending.get(key);
  if (!work) {
    work = (async () => {
      try {
        const fetched = await fetchYoutubeTranscript(videoId, AbortSignal.timeout(45000));
        const segments = fetched.segments.map((s) => ({ ...s, text: normal(s.text) })).filter((s) => s.text);
        const transcript = transcriptSchema.parse({
          ...fetched,
          title: fetched.title.slice(0, 500),
          segments,
          videoId,
          fetchedAt: new Date().toISOString(),
        });
        if (segments.reduce((n, s) => n + s.text.length, 0) > 300000)
          throw new Error('Das Transkript ist zu lang (maximal 300.000 Zeichen).');
        await db.query(
          "INSERT INTO youtube_transcript_cache(user_id,video_id,document,expires_at) VALUES($1,$2,$3,now()+interval '7 days') ON CONFLICT(user_id,video_id) DO UPDATE SET document=excluded.document,expires_at=excluded.expires_at",
          [user, videoId, JSON.stringify(transcript)],
        );
        return transcript;
      } catch (error) {
        const message =
          error instanceof Error && error.name.startsWith('YoutubeTranscript')
            ? 'YouTube-Transkript nicht abrufbar. Untertitel fehlen oder YouTube blockiert den Zugriff.'
            : error instanceof z.ZodError
              ? 'YouTube hat keine gültigen Untertitel geliefert.'
              : error instanceof Error && error.name === 'TimeoutError'
                ? 'Zeitlimit beim YouTube-Transkriptabruf.'
                : error instanceof Error
                  ? error.message
                  : 'YouTube-Transkript nicht abrufbar.';
        await db.query(
          "INSERT INTO youtube_transcript_cache(user_id,video_id,document,expires_at) VALUES($1,$2,$3,now()+interval '1 minute') ON CONFLICT(user_id,video_id) DO UPDATE SET document=excluded.document,expires_at=excluded.expires_at",
          [user, videoId, JSON.stringify({ error: message })],
        );
        throw new Error(message);
      }
    })().finally(() => pending!.delete(key));
    pending.set(key, work);
  }
  const transcript = await work;
  parentSignal?.throwIfAborted();
  return transcript;
}

export function transcriptSource(transcript: YoutubeTranscript, budget = 16000): BrowserSource {
  const segments: YoutubeTranscript['segments'] = [];
  const lines: string[] = [];
  let length = 0;
  for (const segment of transcript.segments) {
    const line = `[${transcriptTime(segment.offset)}] ${segment.text}`;
    if (length + line.length + 1 > budget) break;
    segments.push(segment);
    lines.push(line);
    length += line.length + 1;
  }
  if (!segments.length) throw new Error('Das Transkript enthält keinen verwendbaren Textabschnitt.');
  return {
    title: transcript.title || 'YouTube-Video',
    url: youtubeUrl(transcript.videoId),
    text: lines.join('\n'),
    targets: [],
    links: [],
    pageIndex: -1,
    transcript: { ...transcript, segments, partial: segments.length < transcript.segments.length },
  };
}

/** Link timestamps are derived from fetched captions, never supplied by the model. */
export function transcriptCitation(source: BrowserSource, quote: string): TranscriptCitation | undefined {
  const transcript = source.transcript;
  if (!transcript || !normal(quote)) return;
  for (let index = 0; index < transcript.segments.length; index++) {
    const segment = transcript.segments[index];
    // Permit a quote spanning adjacent caption lines, but never across a time gap.
    const parts = [segment.text];
    for (const next of transcript.segments.slice(index + 1, index + 4)) {
      if (next.offset > segment.offset + segment.duration + 20) break;
      parts.push(next.text);
    }
    const position = normal(parts.join(' ')).indexOf(normal(quote));
    if (position >= 0 && position < normal(segment.text).length)
      return {
        quote,
        start: segment.offset,
        language: segment.lang,
        automatic: transcript.automatic,
      };
  }
}

export async function noteTranscripts(db: Database, user: string, content: string, signal?: AbortSignal) {
  const ids = [
    ...new Set(
      commandUrls(withoutNoteCommands(content))
        .map(youtubeVideoId)
        .filter((id): id is string => !!id),
    ),
  ];
  const sources: BrowserSource[] = [],
    warnings: string[] = [];
  if (ids.length > 3) warnings.push('Es werden höchstens drei YouTube-Videos pro Notiz ausgewertet.');
  for (const id of ids.slice(0, 3)) {
    try {
      const source = transcriptSource(await youtubeTranscript(db, user, youtubeUrl(id), signal), 5000);
      sources.push(source);
      if (source.transcript?.partial)
        warnings.push(`${source.title}: Nur der Anfang des Transkripts passt in die Hintergrundrecherche.`);
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push(
        `${youtubeUrl(id)}: ${error instanceof Error ? error.message : 'Transkript nicht abrufbar.'}`,
      );
    }
  }
  return { sources, warnings };
}
