/** Only known YouTube video URL forms; never accept lookalike domains. */
export function youtubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return;
    const host = url.hostname.toLowerCase();
    let id: string | null | undefined;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (
      [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'www.youtube-nocookie.com',
        'youtube-nocookie.com',
      ].includes(host)
    ) {
      id =
        url.pathname === '/watch'
          ? url.searchParams.get('v')
          : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch {
    return;
  }
}
export const youtubeUrl = (id: string, seconds?: number) =>
  `https://www.youtube.com/watch?v=${id}${seconds === undefined ? '' : `&t=${Math.floor(seconds)}s`}`;
export function transcriptTime(seconds: number) {
  const s = Math.floor(seconds);
  return (
    (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') +
    `${Math.floor(s / 60) % 60}`.padStart(2, '0') +
    ':' +
    `${s % 60}`.padStart(2, '0')
  );
}
export interface TranscriptCitation {
  quote: string;
  start: number;
  language: string;
  automatic: boolean;
}
