import { DocumentDownloadError, resolveDocumentFile } from './document-download.js';
import { publicUrl } from './browser-network.js';
import { sourceIdentity } from '../src/document-origin.js';
import type { DocumentAvailability } from '../src/document-availability.js';

const cache = new Map<string, { expires: number; result: Promise<DocumentAvailability> }>();
const waiters: (() => void)[] = [];
let active = 0;
async function inspect(url: string): Promise<DocumentAvailability> {
  if (active >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
  try {
    await resolveDocumentFile(url, AbortSignal.timeout(45000), true);
    return { status: 'available', message: 'Frei zugängliches PDF gefunden.' };
  } catch (error) {
    return error instanceof DocumentDownloadError
      ? { status: error.availability, message: error.message }
      : {
          status: 'unknown',
          message: 'PDF-Verfügbarkeit derzeit nicht prüfbar. Bitte später erneut prüfen.',
        };
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}
/** Anonymous HTTP/browser checks only: no model, embeddings or document imports. */
export function checkDocumentAvailability(url: string, refresh = false) {
  try {
    publicUrl(url);
  } catch {
    throw Object.assign(new Error('Nur öffentliche Quellenlinks sind erlaubt.'), { statusCode: 400 });
  }
  const key = sourceIdentity(url),
    entry = cache.get(key);
  // Pending checks are shared even when several views request a refresh.
  if (entry && (entry.expires === Infinity || (!refresh && entry.expires > Date.now()))) return entry.result;
  if ([...cache.values()].filter((value) => value.expires === Infinity).length >= 12)
    throw Object.assign(new Error('Viele Quellen werden gerade geprüft. Bitte kurz warten.'), {
      statusCode: 429,
    });
  if (cache.size >= 128) {
    const oldest = [...cache.entries()].find(([, value]) => value.expires !== Infinity)?.[0];
    if (oldest) cache.delete(oldest);
  }
  const result = inspect(url).then((value) => {
    if (cache.get(key)?.result === result)
      cache.set(key, { result, expires: Date.now() + (value.status === 'unknown' ? 30000 : 15 * 60000) });
    return value;
  });
  cache.set(key, { result, expires: Infinity });
  return result;
}
