import type { CommandResult } from './note-command';
import type { PresentationSection } from './command-presentation';
import { transcriptTime } from './youtube';

export function resultKind(item: CommandResult['items'][number]) {
  return item.kind === 'proposal'
    ? 'Vorschlag'
    : item.kind === 'inference'
      ? 'Schlussfolgerung'
      : item.kind === 'fact'
        ? 'Aus den Quellen'
        : '';
}
const label = (text: string) => text.replace(/[\[\]\\]/g, '\\$&').replace(/\n/g, ' ');
const link = (title: string, url: string) =>
  `[${label(title)}](${url.replace(/[\s()<>]/g, (c) => encodeURIComponent(c))})`;
export function itemEvidenceText(item: CommandResult['items'][number]) {
  const parts: string[] = [];
  if (item.citation) {
    const c = item.citation;
    parts.push(`Quelle: ${link(c.title, `notes/${c.noteId}`)}${c.page ? `, Seite ${c.page}` : ''}`);
    if (c.quote) parts.push(`> ${c.quote.replace(/\n/g, '\n> ')}`);
  }
  if (item.url && /^https?:\/\//i.test(item.url)) {
    parts.push(
      `Quelle: ${link(item.transcriptCitation ? `YouTube · ${transcriptTime(item.transcriptCitation.start)}` : item.title, item.url)}`,
    );
    if (item.transcriptCitation) parts.push(`> ${item.transcriptCitation.quote.replace(/\n/g, '\n> ')}`);
  }
  return parts.join('\n\n');
}
export function itemTaskText(item: CommandResult['items'][number]) {
  return [`- [ ] ${item.title.replace(/\n/g, ' ')}`, item.detail, itemEvidenceText(item)]
    .filter(Boolean)
    .join('\n\n');
}
export function commandResultMarkdown(result: CommandResult, sections?: PresentationSection[]) {
  const parts = [result.research || result.summary];
  if (result.partial) parts.unshift('> Teilergebnis – bitte Einschränkungen und Quellen prüfen.');
  const groups = sections || [{ type: 'SourceCards' as const, items: result.items.map((_, i) => i) }];
  for (const group of groups) {
    if (group.type === 'Comparison') {
      const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      parts.push(
        '### Vergleich\n\n| Aspekt | Ergebnis | Einordnung |\n| --- | --- | --- |\n' +
          group.items
            .map((i) => {
              const item = result.items[i];
              return `| ${cell(item.title)} | ${cell(item.detail)} | ${resultKind(item)} |`;
            })
            .join('\n'),
      );
      for (const i of group.items) {
        const evidence = itemEvidenceText(result.items[i]);
        if (evidence) parts.push(`**${label(result.items[i].title)}**\n\n${evidence}`);
      }
    } else {
      if (group.type === 'Plan') parts.push('### Ablaufplan');
      for (const [step, i] of group.items.entries()) {
        const item = result.items[i];
        parts.push(
          `### ${group.type === 'Plan' ? `${step + 1}. ` : ''}${item.title}\n\n${resultKind(item) ? `${resultKind(item)}: ` : ''}${item.detail}`,
        );
        const evidence = itemEvidenceText(item);
        if (evidence) parts.push(evidence);
      }
    }
  }
  if (result.warnings.length)
    parts.push(`Hinweise:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}
