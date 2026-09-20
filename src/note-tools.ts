import { titleOf, type Note } from './domain';

export function noteLink(note: Note): string {
  const title = titleOf(note.content).replace(/[\\[\]]/g, '\\$&');
  return `[${title}](notes/${note.id})`;
}

export function noteReferenceIds(content: string): string[] {
  const text = content
    .replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)/g, '')
    .replace(/(`+)[\s\S]*?\1/g, '');
  return [
    ...new Set(
      [...text.matchAll(/(?<![!\\])\[(?:\\.|[^\]\\\n])*\]\(notes\/([a-f0-9-]{36})\)/g)].map((m) => m[1]),
    ),
  ];
}

export function linkedNotes(content: string, notes: Note[], scope: string): Note[] {
  const ids = noteReferenceIds(content);
  return ids.flatMap((id) => notes.filter((n) => n.id === id && n.scope === scope && !n.deleted));
}

export function backlinks(note: Note, notes: Note[]): Note[] {
  return notes.filter(
    (n) =>
      n.id !== note.id &&
      n.scope === note.scope &&
      !n.deleted &&
      noteReferenceIds(n.content).includes(note.id),
  );
}

export type Format =
  'bold' | 'italic' | 'heading' | 'bullet' | 'number' | 'task' | 'quote' | 'link' | 'table';
export function formatText(text: string, start: number, end: number, kind: Format) {
  let replacement: string;
  let selectionStart = start;
  let selectionEnd = end;
  if (kind === 'table') {
    const prefix = start > 0 ? '\n\n' : '';
    const selected = text.slice(start, end);
    const rows = (selected || 'Eintrag')
      .split(/\r?\n/)
      .map((line) => `| ${line.replace(/\|/g, '&#124;')} |  |`)
      .join('\n');
    replacement = `${prefix}| Bezeichnung | Inhalt |\n| --- | --- |\n${rows}\n\n`;
    selectionStart = start + prefix.length + 2;
    selectionEnd = selectionStart + 'Bezeichnung'.length;
  } else if (kind === 'bold' || kind === 'italic') {
    const marker = kind === 'bold' ? '**' : '*';
    const selected = text.slice(start, end) || 'Text';
    if (
      start >= marker.length &&
      text.slice(start - marker.length, start) === marker &&
      text.slice(end, end + marker.length) === marker
    ) {
      start -= marker.length;
      end += marker.length;
      replacement = selected;
      selectionStart = start;
      selectionEnd = start + selected.length;
    } else {
      replacement = marker + selected + marker;
      selectionStart = start + marker.length;
      selectionEnd = selectionStart + selected.length;
    }
  } else if (kind === 'link') {
    const selected = text.slice(start, end) || 'Linktext';
    const label = selected.replace(/[\\[\]]/g, '\\$&');
    replacement = `[${label}](https://)`;
    selectionStart = start + label.length + 3;
    selectionEnd = selectionStart + 8;
  } else {
    start = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
    const searchEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
    const nextLine = text.indexOf('\n', searchEnd);
    end = nextLine < 0 ? text.length : nextLine;
    const lines = text.slice(start, end).split('\n');
    const pattern =
      kind === 'heading'
        ? /^#{1,6} /
        : kind === 'bullet'
          ? /^[-*+] (?!\[[ xX]\] )/
          : kind === 'number'
            ? /^\d+\. /
            : kind === 'task'
              ? /^[-*+] \[[ xX]\] /
              : /^> /;
    const remove = lines.every((line) => pattern.test(line));
    replacement = lines
      .map((line, i) => {
        if (remove) return line.replace(pattern, '');
        const prefix =
          kind === 'heading'
            ? '## '
            : kind === 'bullet'
              ? '- '
              : kind === 'number'
                ? `${i + 1}. `
                : kind === 'task'
                  ? '- [ ] '
                  : '> ';
        return prefix + line.replace(/^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+\. |> )/, '');
      })
      .join('\n');
    selectionStart = start;
    selectionEnd = start + replacement.length;
  }
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    start: selectionStart,
    end: selectionEnd,
  };
}

export function normalizeCollections(names: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of names) {
    const name = value.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name && !unique.has(name.toLocaleLowerCase('de'))) unique.set(name.toLocaleLowerCase('de'), name);
  }
  return [...unique.values()].slice(0, 30);
}
