import { describe, expect, it } from 'vitest';
import { compactParenthesizedLines } from './annotation-markdown';

describe('compactParenthesizedLines', () => {
  it('keeps parentheses and markdown links on one visual line', () => {
    expect(compactParenthesizedLines('Hinweis (\n\nQuelle\n\n)')).toBe('Hinweis (Quelle)');
    expect(compactParenthesizedLines('[Quelle](\nhttps://example.com\n)')).toBe(
      '[Quelle](https://example.com)',
    );
  });

  it('preserves line breaks inside the parenthesized content', () => {
    expect(compactParenthesizedLines('(\nErste Zeile\nZweite Zeile\n)')).toBe('(Erste Zeile\nZweite Zeile)');
  });
});
