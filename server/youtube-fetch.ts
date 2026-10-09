import { request } from 'node:https';
import { fetchTranscript } from 'youtube-transcript-plus';
import { publicUrl, resolvePublic } from './browser-network.js';
// Explicit hook shape: upstream's extensionless .d.ts imports lose types in NodeNext.
export interface FetchParams {
  url: string;
  userAgent?: string;
  method?: 'GET' | 'POST';
  body?: string;
  signal?: AbortSignal;
}

/** The library never gets an unrestricted fetch: pin public DNS and bound every response. */
export async function youtubeFetch(params: FetchParams): Promise<Response> {
  const url = publicUrl(params.url);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    !['www.youtube.com', 'youtube.com', 'video.google.com'].includes(host) ||
    !['/watch', '/youtubei/v1/player', '/api/timedtext', '/timedtext'].includes(url.pathname) ||
    (params.method === 'POST' && url.pathname !== '/youtubei/v1/player')
  )
    throw new Error('Nicht erlaubtes Ziel für YouTube-Untertitel.');
  const signal = params.signal ?? AbortSignal.timeout(25000);
  signal.throwIfAborted();
  const target = await resolvePublic(host);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: params.method ?? 'GET',
        signal,
        family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        headers: {
          'User-Agent': params.userAgent ?? 'Noto transcript reader/1.0',
          'Accept-Encoding': 'identity',
          ...(params.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          res.destroy();
          reject(
            new Error(
              status === 429 || status === 403
                ? 'YouTube blockiert den Untertitelabruf derzeit.'
                : 'YouTube ist nicht direkt erreichbar (möglicherweise Anmeldung oder Einwilligung erforderlich).',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const maximum = 6 * 1024 * 1024;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) {
            res.destroy();
            reject(new Error('YouTube-Antwort zu groß.'));
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status })));
      },
    );
    req.setTimeout(25000, () => req.destroy(new Error('Zeitlimit beim YouTube-Abruf.')));
    req.on('error', reject);
    req.end(params.body);
  });
}

export async function fetchYoutubeTranscript(videoId: string, signal: AbortSignal, transport = youtubeFetch) {
  let automatic = false;
  const result = (await fetchTranscript(videoId, {
    videoDetails: true,
    retries: 0,
    signal,
    videoFetch: transport,
    transcriptFetch: transport,
    playerFetch: async (params: FetchParams) => {
      const response = await transport(params);
      const player = await response.json();
      if (player.playabilityStatus?.status !== 'OK')
        throw new Error('YouTube gibt das Video nicht frei (gesperrt, privat oder Anmeldung erforderlich).');
      if (player.videoDetails?.videoId && player.videoDetails.videoId !== videoId)
        throw new Error('YouTube hat ein anderes Video geliefert.');
      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!Array.isArray(tracks) || !tracks.length)
        throw new Error('Für dieses Video sind keine Untertitel verfügbar.');
      const rank = (track: { languageCode?: string; kind?: string }) =>
        (/^de(?:-|$)/.test(track.languageCode ?? '')
          ? 0
          : /^en(?:-|$)/.test(track.languageCode ?? '')
            ? 2
            : 4) + (track.kind === 'asr' ? 1 : 0);
      tracks.sort((a, b) => rank(a) - rank(b));
      automatic = tracks[0].kind === 'asr';
      return new Response(JSON.stringify(player), { status: 200 });
    },
  })) as {
    videoDetails: { title: string };
    segments: { text: string; offset: number; duration: number; lang: string }[];
  };
  return { title: result.videoDetails.title, automatic, segments: result.segments };
}
