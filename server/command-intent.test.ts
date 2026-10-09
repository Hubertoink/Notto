import { expect, it } from 'vitest';
import { commandFocusesVideo, commandNeedsSearch } from './command-intent';

export const videoTransferPrompt =
  'Fasse die Kernaussagen des verlinkten Videos zum selbstregulierten Lernen zusammen. Welche Ansätze lassen sich auf die offene Jugendarbeit übertragen? Trenne Aussagen aus dem Video von eigenen Vorschlägen und belege die Videoaussagen mit Zeitmarken.';

it('selects the explicitly requested video while retaining explicitly requested documents', () => {
  const content = '[Video](https://youtu.be/kvSFQ5lkcaI)\n[Quality Youth Work](attachments/source.pdf)';
  expect(commandFocusesVideo(videoTransferPrompt, content)).toBe(true);
  for (const prompt of [
    'Fasse Video und PDF zusammen',
    'Vergleiche das Video mit Quality Youth Work',
    'Beziehe das Video auf meine Notiz',
    'Fasse das zusammen',
  ])
    expect(commandFocusesVideo(prompt, content)).toBe(false);
  expect(commandFocusesVideo(videoTransferPrompt, 'Kein Link')).toBe(false);
});

it('applies supplied video content without researching unrelated suggestions', () => {
  expect(commandNeedsSearch(videoTransferPrompt, true, true)).toBe(false);
  expect(commandNeedsSearch('Welche Ansätze aus dem Video lassen sich übertragen?', true, true)).toBe(false);
  expect(commandNeedsSearch('Fasse das Video zusammen und recherchiere Alternativen', true, true)).toBe(true);
  expect(commandNeedsSearch('Empfiehl weitere Videos', true, true)).toBe(true);
  expect(commandNeedsSearch('Welche Videos eignen sich?')).toBe(true);
});

it.each([
  'Gib mir fünf Gemeinschaftsspiele für Jugendliche ab 12, einfach und kommunikativ.',
  'Plane einen spielerischen Abend mit passenden Spielen.',
  'Welche Werkzeuge eignen sich für dieses Projekt?',
  'Fasse die Notiz zusammen und empfehle Alternativen.',
  'Ich brauche zum Einstieg Artikel und Lesempfehlungen zu seinen Theorien.',
  'Empfiehl mir Bücher zu Brooks.',
  'Welche Artikel eignen sich zum Einstieg?',
  'Gib mir eine Literaturliste.',
  'Was sollte ich dazu lesen?',
  'Nenne weiterführende Quellen.',
  'Suche Rezensionen zu den letzten drei Veröffentlichungen',
])('researches open-ended requests across topics: %s', (prompt) => {
  expect(commandNeedsSearch(prompt)).toBe(true);
});

it.each([
  'Fasse diesen Artikel zusammen.',
  'Übersetze die Leseliste ins Deutsche.',
  'Sortiere meine Buchempfehlungen.',
  'Korrigiere die Notiz.',
  'Empfiehl Spiele nur aus meiner Notiz.',
  'Gib mir Ideen ohne Websuche.',
  'Zeige ein passendes Icon',
])('keeps source transformations local: %s', (prompt) => {
  expect(commandNeedsSearch(prompt)).toBe(false);
});

it('researches visual requests without a source while respecting explicit search restrictions', () => {
  expect(commandNeedsSearch('Zeige ein passendes Icon', false)).toBe(true);
  expect(commandNeedsSearch('Zeige ein passendes Icon ohne Websuche', false)).toBe(false);
  expect(commandNeedsSearch('Suche Empfehlungen ausschließlich anhand dieser Notiz', false)).toBe(false);
});
