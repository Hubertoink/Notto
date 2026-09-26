import { expect, it } from 'vitest';
import { citedSearch } from './command-search';

const response = (text: string, annotations: unknown[], searched = true) => ({
  status: 'completed',
  output: [
    ...(searched ? [{ type: 'web_search_call', status: 'completed' }] : []),
    { content: [{ type: 'output_text', text, annotations }] },
  ],
});
it('requires a completed search and real provider citations', () => {
  expect(() => citedSearch(response('Unbelegte Behauptung', []))).toThrow('zitierbaren');
  expect(() => citedSearch(response('Keine Suche', [], false))).toThrow('nicht abgeschlossen');
  expect(() =>
    citedSearch(
      response('Text [1]', [
        { type: 'url_citation', start_index: 5, end_index: 8, title: 'Intern', url: 'http://127.0.0.1' },
      ]),
    ),
  ).toThrow('zitierbaren');
});
it('keeps multiple citation positions and titles intact', () => {
  const result = citedSearch(
    response('Erstens [1]. Zweitens [2].', [
      {
        type: 'url_citation',
        start_index: 8,
        end_index: 11,
        title: 'Quelle eins',
        url: 'https://example.com/one',
      },
      {
        type: 'url_citation',
        start_index: 22,
        end_index: 25,
        title: 'Quelle zwei',
        url: 'https://example.com/two',
      },
    ]),
  );
  expect(result.text).toBe(
    'Erstens  [Quelle eins](https://example.com/one). Zweitens  [Quelle zwei](https://example.com/two).',
  );
  expect(result.sources).toHaveLength(2);
});
