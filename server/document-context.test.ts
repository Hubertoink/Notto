import { expect, it, vi } from 'vitest';
import { serverDocumentContext } from './document-context';
import type { Database } from './database';

it('reuses preparation across note revisions, invalidates changed extraction text and isolates users', async () => {
  const cache = new Map<string, { fingerprint: string; document: unknown }>();
  const query = vi.fn(async (sql: string, args: any[]) => {
    const key = `${args[0]}:${args[1]}`;
    if (sql.startsWith('INSERT')) cache.set(key, { fingerprint: args[2], document: JSON.parse(args[3]) });
    const stored = cache.get(key);
    return { rows: stored?.fingerprint === args[2] ? [{ document: stored.document }] : [] };
  });
  const db = { query } as unknown as Database;
  const source = {
    noteId: 'first',
    revision: 'r1',
    attachment: 'a.pdf',
    page: 2,
    text: 'Ownership. '.repeat(6000),
  };
  await serverDocumentContext(db, 'alice', [source], 'first', 'Ownership');
  const writes = () => query.mock.calls.filter(([sql]) => sql.startsWith('INSERT')).length;
  expect(writes()).toBe(1);
  const reused = await serverDocumentContext(
    db,
    'alice',
    [{ ...source, noteId: 'second', revision: 'r2' }],
    'second',
    'Ownership',
  );
  expect(writes()).toBe(1);
  expect(reused.sources.every((s) => s.noteId === 'second' && s.revision === 'r2')).toBe(true);
  await serverDocumentContext(
    db,
    'alice',
    [{ ...source, text: 'Verbesserter OCR-Text.' }],
    'first',
    'Ownership',
  );
  expect(writes()).toBe(2);
  await serverDocumentContext(db, 'bob', [source], 'first', 'Ownership');
  expect(writes()).toBe(3);
});
