import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchDocumentBytes, downloadDocument } from './document-download';
import { checkDocumentAvailability } from './document-availability';
const browserActivity = vi.hoisted(() => ({ active: 0, peak: 0 }));
const metadata = vi.hoisted(() => ({
  title: 'Originalartikel',
  authors: ['Autorin'],
  pdfUrls: [] as string[],
  doi: '10.1234/test',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}));
vi.mock('./browser-network', async (original) => {
  const actual = await original<typeof import('./browser-network')>();
  return {
    ...actual,
    publicUrl(value: string) {
      const url = new URL(value);
      const validation = new URL(value);
      if (url.hostname === 'example.com') validation.port = '';
      actual.publicUrl(validation.href);
      return url;
    },
    resolvePublic: vi.fn(async () => ({ address: '127.0.0.1', family: 4 })),
  };
});
vi.mock('./command-browser', () => ({
  CommandBrowser: class {
    read = vi.fn(async () => {
      browserActivity.active++;
      browserActivity.peak = Math.max(browserActivity.peak, browserActivity.active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      browserActivity.active--;
      return { document: metadata };
    });
    cookies = vi.fn(async () => 'anonymous=1');
    close = vi.fn(async () => {});
  },
}));
function pdf() {
  const stream = 'BT /F1 12 Tf 20 80 Td (Ownership supports responsibility.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = result.length;
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
let base: string;
let requestedRange: string | undefined;
const requests = new Map<string, number>();
const fixture = createServer((req, res) => {
  requests.set(req.url!, (requests.get(req.url!) ?? 0) + 1);
  requestedRange = req.headers.range;
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/pdf' });
    res.end();
  } else if (req.url === '/private') {
    res.writeHead(302, { location: 'http://127.0.0.1/secret' });
    res.end();
  } else if (req.url === '/oversize') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 13 * 1024 * 1024 });
    res.end();
  } else if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(Buffer.alloc(13 * 1024 * 1024));
  } else if (req.url === '/blocked' || req.url === '/transient') {
    res.writeHead(req.url === '/blocked' ? 403 : 503, { 'content-type': 'text/html' });
    res.end('Nicht verfügbar');
  } else if (req.url === '/no-range.pdf') {
    res.writeHead(req.headers.range ? 416 : 200, { 'content-type': 'application/pdf' });
    res.end(req.headers.range ? '' : pdf());
  } else if (
    req.url === '/pdf' ||
    req.url === '/probe.pdf' ||
    (req.url === '/cookie-pdf' && req.headers.cookie === 'anonymous=1')
  ) {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(pdf());
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>Anmelden</html>');
  }
});
beforeEach(() => {
  metadata.pdfUrls = [`${base}/cookie-pdf`];
});
beforeAll(async () => {
  await new Promise<void>((done) => fixture.listen(0, '127.0.0.1', done));
  base = `http://example.com:${(fixture.address() as AddressInfo).port}`;
  metadata.pdfUrls = [`${base}/cookie-pdf`];
});
afterAll(async () => {
  fixture.closeAllConnections();
  await new Promise<void>((done) => fixture.close(() => done()));
});
it('follows public redirects and returns actual bytes', async () => {
  const result = await fetchDocumentBytes(`${base}/redirect`, AbortSignal.timeout(5000));
  expect(result.bytes).toEqual(pdf());
  expect(result.url).toBe(`${base}/pdf`);
});
it('blocks private redirect destinations', async () => {
  await expect(fetchDocumentBytes(`${base}/private`, AbortSignal.timeout(5000))).rejects.toThrow();
});
it.each(['/oversize', '/stream'])(
  'enforces the byte limit for declared and streamed responses: %s',
  async (path) => {
    await expect(fetchDocumentBytes(`${base}${path}`, AbortSignal.timeout(5000))).rejects.toThrow('12 MB');
  },
);
it('resolves publisher PDF metadata with anonymous cookies and extracts real page text', async () => {
  const result = await downloadDocument(`${base}/article`);
  expect(result.source).toMatchObject({
    title: 'Originalartikel',
    doi: '10.1234/test',
    authors: ['Autorin'],
    pdfUrl: `${base}/cookie-pdf`,
  });
  expect(result.pages).toEqual([{ page: 1, text: 'Ownership supports responsibility.' }]);
  expect(result.needsOCR).toBe(false);
}, 20000);
it('rejects an HTML login page pretending to be the PDF', async () => {
  metadata.pdfUrls = [`${base}/fake.pdf`];
  await expect(downloadDocument(`${base}/article`)).rejects.toThrow('Keine frei herunterladbare PDF');
});
it('checks direct PDFs using a bounded range request without reading or storing the whole file', async () => {
  const result = await fetchDocumentBytes(`${base}/probe.pdf`, AbortSignal.timeout(5000), undefined, true);
  expect(requestedRange).toBe('bytes=0-4095');
  expect(result.bytes.length).toBeLessThanOrEqual(4096);
  expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
});
it('shares pending and cached checks without making a model request', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const before = requests.get('/probe.pdf') ?? 0;
  try {
    const results = await Promise.all([
      checkDocumentAvailability(`${base}/probe.pdf`),
      checkDocumentAvailability(`${base}/probe.pdf`),
    ]);
    expect(results.every((value) => value.status === 'available')).toBe(true);
    await checkDocumentAvailability(`${base}/probe.pdf`);
    expect(requests.get('/probe.pdf')).toBe(before + 1);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
it('falls back to a bounded ordinary GET when a publisher rejects range requests', async () => {
  const result = await checkDocumentAvailability(`${base}/no-range.pdf`);
  expect(result.status).toBe('available');
  expect(requests.get('/no-range.pdf')).toBe(2);
  expect(requestedRange).toBeUndefined();
});
it('classifies absent and protected PDFs as unavailable and lets a user explicitly recheck', async () => {
  metadata.pdfUrls = [`${base}/fake.pdf`];
  expect((await checkDocumentAvailability(`${base}/without-pdf`)).status).toBe('unavailable');
  metadata.pdfUrls = [`${base}/blocked`];
  expect((await checkDocumentAvailability(`${base}/protected-article`)).status).toBe('unavailable');
  metadata.pdfUrls = [`${base}/cookie-pdf`];
  expect((await checkDocumentAvailability(`${base}/without-pdf`)).status).toBe('unavailable');
  expect((await checkDocumentAvailability(`${base}/without-pdf`, true)).status).toBe('available');
});
it('does not label an upstream outage as a missing PDF', async () => {
  metadata.pdfUrls = [`${base}/transient`];
  expect((await checkDocumentAvailability(`${base}/temporarily-unreachable`)).status).toBe('unknown');
});
it('runs at most two publisher checks at a time', async () => {
  browserActivity.peak = 0;
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) => checkDocumentAvailability(`${base}/parallel-article-${index}`)),
  );
  expect(results.every((value) => value.status === 'available')).toBe(true);
  expect(browserActivity.peak).toBe(2);
});
it('rejects private URLs before launching a check', () => {
  expect(() => checkDocumentAvailability('http://127.0.0.1/secret')).toThrow('öffentliche');
});
