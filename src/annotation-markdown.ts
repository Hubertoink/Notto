/**
 * AI research occasionally puts the edges of a parenthesized value on their
 * own lines. That creates visible, empty paragraphs in the annotation panel
 * and also breaks otherwise valid Markdown links such as `](\nurl\n)`.
 */
export function compactParenthesizedLines(markdown: string): string {
  return markdown.replace(/\(\s*\n\s*([\s\S]*?)\s*\n\s*\)/g, (_match, body: string) => `(${body.trim()})`);
}
