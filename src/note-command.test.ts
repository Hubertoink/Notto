import { expect, it } from 'vitest';
import { noteCommands, commandUrls } from './note-command';
it('requires a command at the start of a line and ignores quoted or fenced examples', () => {
  const text =
    'Titel\n/ki Fasse die Seite zusammen\n\n```text\n/ki Nicht starten\n```\n> /ki Zitat\nEin /ki Beispiel\n    /ki eingerückter Code\n/ki';
  const commands = noteCommands(text);
  expect(commands.map((c) => c.prompt)).toEqual(['Fasse die Seite zusammen', '']);
  expect(text.slice(commands[0].start, commands[0].end)).toBe('/ki Fasse die Seite zusammen');
});
it('extracts markdown and plain links in their original priority', () => {
  expect(commandUrls('[Seite](https://example.com/a). https://example.com/b! https://example.com/a')).toEqual(
    ['https://example.com/a', 'https://example.com/b'],
  );
});
