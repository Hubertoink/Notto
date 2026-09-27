import { expect, it } from 'vitest';
import { commandNeedsSearch } from './command-intent';

it.each([
  'Ich brauche zum Einstieg Artikel und Lesempfehlungen zu seinen Theorien.',
  'Empfiehl mir Bücher zu Brooks.',
  'Welche Artikel eignen sich zum Einstieg?',
  'Gib mir eine Literaturliste.',
  'Was sollte ich dazu lesen?',
  'Nenne weiterführende Quellen.',
  'Suche Rezensionen zu den letzten drei Veröffentlichungen',
])('routes literature requests to web search: %s', (prompt) => {
  expect(commandNeedsSearch(prompt)).toBe(true);
});

it.each([
  'Fasse diesen Artikel zusammen.',
  'Übersetze die Leseliste ins Deutsche.',
  'Sortiere meine Buchempfehlungen.',
  'Korrigiere die Notiz.',
  'Zeige ein passendes Icon',
])('keeps source transformations local: %s', (prompt) => {
  expect(commandNeedsSearch(prompt)).toBe(false);
});
