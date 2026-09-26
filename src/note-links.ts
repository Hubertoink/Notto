export const relationLabels = {
  theory: 'Theoretische Grundlage',
  application: 'Anwendung',
  evidence: 'Beleg',
  context: 'Assoziation / Kontext',
};
export type LinkRelation = keyof typeof relationLabels;
export type NoteLinkTarget = { id: string; relation?: LinkRelation };
const idPattern = /^[a-f0-9-]{36}$/;
const relation = (value: string | null): LinkRelation | undefined =>
  value && Object.hasOwn(relationLabels, value) ? (value as LinkRelation) : undefined;

export function parseNoteLink(href = ''): NoteLinkTarget[] {
  const match = href.match(/^notes\/([a-f0-9-]{36})(?:\?([^\s#]*))?$/);
  if (!match) return [];
  const query = new URLSearchParams(match[2]);
  const targets: NoteLinkTarget[] = [{ id: match[1], relation: relation(query.get('type')) }];
  for (const extra of query.getAll('also')) {
    const [id, kind] = extra.split(':');
    if (!idPattern.test(id)) return [];
    if (!targets.some((target) => target.id === id)) targets.push({ id, relation: relation(kind) });
  }
  return targets;
}

export function noteLinkHref(targets: NoteLinkTarget[]) {
  const [first, ...rest] = targets;
  const query = new URLSearchParams();
  if (first.relation) query.set('type', first.relation);
  for (const target of rest) query.append('also', target.id + (target.relation ? ':' + target.relation : ''));
  return `notes/${first.id}${query.size ? '?' + query : ''}`;
}

export function noteLinkRanges(content: string) {
  const code = [
    ...content.matchAll(
      /(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*(?=\n|$)|$)|(`+)[^\n]*?\3/g,
    ),
  ];
  return [...content.matchAll(/(?<![!\\])\[((?:\\.|[^\]\\\n])*)\]\((notes\/[^\s)]+)\)/g)]
    .filter(
      (match) =>
        !code.some((block) => match.index! >= block.index! && match.index! < block.index! + block[0].length),
    )
    .map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
      label: match[1],
      targets: parseNoteLink(match[2]),
    }))
    .filter((link) => link.targets.length > 0);
}

export function plainNoteLinks(content: string) {
  return noteLinkRanges(content).reduceRight(
    (text, link) => text.slice(0, link.start) + link.label + text.slice(link.end),
    content,
  );
}
