import { tagsOf, titleOf, type Attachment, type Note } from './domain.js';
import type { DocumentOrigin } from './document-origin.js';
export const safeLabel = (value: string) => value.replace(/[\[\]\\\r\n]/g, '').trim();
export function documentContent(
  title: string,
  tags: string[],
  attachment: Pick<Attachment, 'id' | 'name'>,
  source?: DocumentOrigin,
) {
  const provenance = source
    ? `\n\nQuelle: [${safeLabel(source.title)}](${source.url.replace(/[()<>\s]/g, (c) => encodeURIComponent(c))})${source.authors?.length ? `\n\nAutoren: ${source.authors.map(safeLabel).join(', ')}` : ''}${source.doi ? `\n\nDOI: ${source.doi}` : ''}${source.licenseUrl ? `\n\n[Lizenz](${source.licenseUrl.replace(/[()<>\s]/g, (c) => encodeURIComponent(c))})` : ''}`
    : '';
  return `${safeLabel(title) || safeLabel(attachment.name)}\n\n${tags.map((tag) => `#${tag}`).join(' ')}\n\n[${safeLabel(attachment.name)}](attachments/${attachment.id})${provenance}`;
}

/** Change the metadata block while retaining source text and additional links. */
export function documentMetadataContent(
  note: Note,
  title = titleOf(note.content),
  tags = tagsOf(note.content),
) {
  const lines = note.content.split('\n');
  lines[0] = safeLabel(title);
  const tagLine = lines.findIndex(
    (line, index) => index > 0 && /^\s*(?:#[\p{L}\p{N}][\p{L}\p{N}_/-]*\s*)+$/u.test(line),
  );
  const value = tags.map((tag) => `#${tag}`).join(' ');
  if (tagLine >= 0) lines[tagLine] = value;
  else if (value) lines.splice(1, 0, '', value);
  return lines.join('\n');
}
