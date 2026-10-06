export interface DocumentOrigin {
  url: string;
  pdfUrl: string;
  title: string;
  authors?: string[];
  doi?: string;
  published?: string;
  licenseUrl?: string;
  importedAt: string;
}

const webUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 3000) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};
export function validDocumentOrigin(value: unknown): value is DocumentOrigin {
  if (!value || typeof value !== 'object') return false;
  const source = value as DocumentOrigin;
  return (
    webUrl(source.url) &&
    webUrl(source.pdfUrl) &&
    typeof source.title === 'string' &&
    source.title.length <= 500 &&
    (source.authors === undefined ||
      (Array.isArray(source.authors) &&
        source.authors.length <= 30 &&
        source.authors.every((name) => typeof name === 'string' && name.length <= 200))) &&
    (source.doi === undefined ||
      (typeof source.doi === 'string' && /^10\.\d{4,9}\/\S{1,200}$/i.test(source.doi))) &&
    (source.published === undefined ||
      (typeof source.published === 'string' && source.published.length <= 100)) &&
    (source.licenseUrl === undefined || webUrl(source.licenseUrl)) &&
    typeof source.importedAt === 'string' &&
    Number.isFinite(Date.parse(source.importedAt))
  );
}

export function sourceIdentity(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.href;
  } catch {
    return url;
  }
}
