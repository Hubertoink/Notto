import type { Attachment } from './domain.js';
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
