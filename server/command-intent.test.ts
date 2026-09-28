import { expect, it } from 'vitest';
import { commandNeedsSearch } from './command-intent';

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
