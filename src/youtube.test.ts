import { expect, it } from 'vitest';
import { youtubeVideoId, youtubeUrl, transcriptTime } from './youtube';

it.each([
  'https://youtu.be/qp0HIF3SfI4?t=123',
  'https://www.youtube.com/watch?v=qp0HIF3SfI4&list=ignored',
  'https://m.youtube.com/watch?v=qp0HIF3SfI4',
  'https://youtube.com/shorts/qp0HIF3SfI4',
  'https://www.youtube-nocookie.com/embed/qp0HIF3SfI4',
  'https://youtube.com/live/qp0HIF3SfI4',
])('recognizes the same video across URL formats: %s', (url) =>
  expect(youtubeVideoId(url)).toBe('qp0HIF3SfI4'),
);
it.each([
  'https://youtube.com.evil.org/watch?v=qp0HIF3SfI4',
  'https://youtube.com@evil.org/watch?v=qp0HIF3SfI4',
  'https://youtu.be/short',
  'https://youtube.com/playlist?list=qp0HIF3SfI4',
  'file:///qp0HIF3SfI4',
  'https://youtube.com:444/watch?v=qp0HIF3SfI4',
])('rejects non-video URLs: %s', (url) => expect(youtubeVideoId(url)).toBeUndefined());
it('formats exact timestamps and safe canonical links', () => {
  expect(transcriptTime(3723.6)).toBe('1:02:03');
  expect(transcriptTime(3)).toBe('00:03');
  expect(youtubeUrl('qp0HIF3SfI4', 123.8)).toBe('https://www.youtube.com/watch?v=qp0HIF3SfI4&t=123s');
});
