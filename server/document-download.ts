import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { publicUrl, resolvePublic } from './browser-network.js';
import { CommandBrowser } from './command-browser.js';
import { sourceIdentity, type DocumentOrigin } from '../src/document-origin.js';

const MAX_BYTES = 12 * 1024 * 1024;
export async function fetchDocumentBytes(
  value: string,
  signal: AbortSignal,
  cookies?: (url: string) => Promise<string>,
) {
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const target = await resolvePublic(url.hostname);
    signal.throwIfAborted();
    const cookie = await cookies?.(url.href);
    const response = await new Promise<{ bytes: Buffer; status: number; location?: string; type: string }>(
      (done, reject) => {
        const call = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            signal,
            family: target.family,
            lookup: (_host, _options, callback) => callback(null, target.address, target.family),
            headers: {
              Accept: 'application/pdf,text/html;q=0.9',
              'Accept-Encoding': 'identity',
              'User-Agent': 'Noto document import/1.0',
              ...(cookie ? { Cookie: cookie } : {}),
            },
          },
          (incoming) => {
            const status = incoming.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              incoming.destroy();
              done({ bytes: Buffer.alloc(0), status, location: incoming.headers.location, type: '' });
              return;
            }
            const type = incoming.headers['content-type'] ?? '';
            const maximum = /html/i.test(type) ? 2 * 1024 * 1024 : MAX_BYTES;
            if (Number(incoming.headers['content-length'] ?? 0) > maximum) {
              incoming.destroy();
              reject(new Error('Die Datei überschreitet die zulässige Größe von 12 MB.'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            incoming.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > maximum) {
                incoming.destroy();
                reject(new Error('Die Datei überschreitet die zulässige Größe von 12 MB.'));
              } else chunks.push(chunk);
            });
            incoming.on('error', reject);
            incoming.on('end', () => done({ bytes: Buffer.concat(chunks), status, type }));
          },
        );
        call.on('error', reject);
        call.end();
      },
    );
    if (response.location) {
      url = publicUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Quelle nicht erreichbar (HTTP ${response.status}).`);
    return { ...response, url: url.href };
  }
  throw new Error('Zu viele Weiterleitungen beim PDF-Download.');
}

export async function downloadDocument(url: string, title = '', parentSignal?: AbortSignal) {
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(60000)])
    : AbortSignal.timeout(60000);
  const browser = new CommandBrowser();
  const close = () => {
    void browser.close();
  };
  signal.addEventListener('abort', close, { once: true });
  const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString() === '%PDF-';
  try {
    let file: Awaited<ReturnType<typeof fetchDocumentBytes>> | undefined;
    let initialError: unknown;
    try {
      file = await fetchDocumentBytes(url, signal);
    } catch (error) {
      signal.throwIfAborted();
      initialError = error;
    }
    let metadata: NonNullable<Awaited<ReturnType<CommandBrowser['read']>>['document']> | undefined;
    if (!file || !isPdf(file.bytes)) {
      // A fresh anonymous browser session resolves publisher metadata and public SSO redirects.
      const page = await browser.read(url);
      metadata = page.document;
      const candidates = metadata?.pdfUrls ?? [];
      const errors: string[] = [];
      for (const candidate of candidates.slice(0, 3)) {
        try {
          const downloaded = await fetchDocumentBytes(candidate, signal, (value) => browser.cookies(value));
          if (isPdf(downloaded.bytes)) {
            file = downloaded;
            break;
          }
          errors.push('Der PDF-Link liefert keine PDF-Datei.');
        } catch (error) {
          signal.throwIfAborted();
          errors.push(error instanceof Error ? error.message : 'Download fehlgeschlagen.');
        }
      }
      if (!file || !isPdf(file.bytes))
        throw new Error(
          `Keine frei herunterladbare PDF gefunden.${errors[0] ? ` ${errors[0]}` : initialError instanceof Error ? ` ${initialError.message}` : ''}`,
        );
    }
    signal.throwIfAborted();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({ data: new Uint8Array(file.bytes), useSystemFonts: true });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 100)
        throw new Error('Das PDF hat mehr als 100 Seiten; bitte eine kürzere Fassung importieren.');
      const info = await pdf.getMetadata().catch(() => undefined);
      const pdfTitle = (info?.info as { Title?: string } | undefined)?.Title;
      const name = (metadata?.title || pdfTitle || title || 'Importierter Artikel').slice(0, 500);
      const pages: { page: number; text: string }[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        signal.throwIfAborted();
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        pages.push({
          page: pageNumber,
          text:
            content.items
              .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
              .join('')
              .trim() || '[Kein Text erkannt. OCR erforderlich.]',
        });
      }
      const source: DocumentOrigin = {
        url: sourceIdentity(url),
        pdfUrl: file.url,
        title: name,
        importedAt: new Date().toISOString(),
        ...(metadata?.authors.length ? { authors: metadata.authors } : {}),
        ...(metadata?.doi ? { doi: metadata.doi } : {}),
        ...(metadata?.published ? { published: metadata.published } : {}),
        ...(metadata?.licenseUrl ? { licenseUrl: metadata.licenseUrl } : {}),
      };
      return {
        bytes: file.bytes,
        source,
        pages,
        needsOCR: pages.some((page) => page.text.startsWith('[Kein Text erkannt.')),
      };
    } finally {
      await loading.destroy();
    }
  } finally {
    signal.removeEventListener('abort', close);
    await browser.close();
  }
}
