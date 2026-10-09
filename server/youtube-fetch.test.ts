import { expect, it, vi } from 'vitest';
import { fetchYoutubeTranscript, youtubeFetch, type FetchParams } from './youtube-fetch';

it('uses the real parser and prefers provided German captions, decoding text and seconds', async () => {
  const transport = vi.fn(async (params: FetchParams) => {
    if (params.url.includes('/watch?')) return new Response('"INNERTUBE_API_KEY":"public-page-key"');
    if (params.method === 'POST')
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: 'qp0HIF3SfI4', title: 'Lernbüro' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' },
              { languageCode: 'de', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?lang=auto' },
              { languageCode: 'de', baseUrl: 'https://www.youtube.com/api/timedtext?lang=de' },
            ],
          },
        },
      });
    expect(params.url).toContain('lang=de');
    return new Response('<transcript><text start="12.5" dur="3.2">Ziele &amp; Planung</text></transcript>');
  });
  const result = await fetchYoutubeTranscript('qp0HIF3SfI4', AbortSignal.timeout(1000), transport);
  expect(result).toEqual({
    title: 'Lernbüro',
    automatic: false,
    segments: [{ text: 'Ziele & Planung', offset: 12.5, duration: 3.2, lang: 'de' }],
  });
  expect(transport).toHaveBeenCalledTimes(3);
});
it.each(['LOGIN_REQUIRED', 'UNPLAYABLE'])(
  'does not treat restricted videos as transcripts: %s',
  async (status) => {
    const transport = vi.fn(async (params: FetchParams) =>
      params.method === 'POST'
        ? Response.json({ playabilityStatus: { status } })
        : new Response('"INNERTUBE_API_KEY":"key"'),
    );
    await expect(fetchYoutubeTranscript('qp0HIF3SfI4', AbortSignal.timeout(1000), transport)).rejects.toThrow(
      'nicht frei',
    );
    expect(transport).toHaveBeenCalledTimes(2);
  },
);
it.each([
  'http://www.youtube.com/watch',
  'https://localhost/api/timedtext',
  'https://www.youtube.com.evil.org/api/timedtext',
  'https://www.youtube.com/account',
])('rejects unsafe subtitle targets before making a request: %s', async (url) => {
  await expect(youtubeFetch({ url })).rejects.toThrow();
});
