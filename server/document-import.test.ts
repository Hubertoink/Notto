import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app';
import { downloadDocument } from './document-download';
import { importWebDocument } from './document-import';
import { commandImportsDocuments } from './command-document-import';
import { workCommandOnce } from './command-worker';
import { openai } from './openai';
import { searchCommand } from './command-search';
import { digest } from './security';
import { newNote, reviseNote, validNote, attachmentIds, contentRevision } from '../src/domain';
import type { Database } from './database';

vi.mock('./document-download', () => ({ downloadDocument: vi.fn() }));
vi.mock('./openai', () => ({ openai: vi.fn() }));
vi.mock('./command-search', () => ({ searchCommand: vi.fn() }));
vi.mock('./command-browser', () => ({
  CommandBrowser: class {
    close = vi.fn(async () => {});
  },
}));
const pg = new PGlite();
const adapter = {
  query: async (sql: string, args?: any[]) => {
    const r = await pg.query(sql, args);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  connect: async () => ({ ...adapter, release() {} }),
} as unknown as Database;
const user = randomUUID(),
  other = randomUUID();
const url = 'https://link.springer.com/article/10.1007/s12054-021-00420-9';
const source = {
  url,
  pdfUrl: 'https://link.springer.com/content/pdf/10.1007/s12054-021-00420-9.pdf',
  title: 'In der Offenen Jugendarbeit geht noch was',
  authors: ['Schwerthelm, Moritz', 'Sturzenhecker, Benedikt'],
  doi: '10.1007/s12054-021-00420-9',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  importedAt: new Date().toISOString(),
};
const downloaded = {
  bytes: Buffer.from('%PDF-test'),
  source,
  pages: [{ page: 1, text: 'Demokratische Selbstorganisation stärkt Beteiligung.' }],
  needsOCR: false,
};
const prompt =
  'Lade die frei verfügbaren Artikel aus dieser Recherche herunter und ordne sie der Sammlung Jugendarbeit zu';
const note = {
  ...newNote(user, `Ownership\n#jugendarbeit #konzeption\n/ki ${prompt}`),
  collections: ['Konzept', 'Team'],
};
let dataDir: string, app: Awaited<ReturnType<typeof buildApp>>;
const settings = {
  enabled: true,
  model: 'gpt-6-luna',
  auto: false,
  autoResearch: false,
  commandWeb: true,
  excludedTags: 'privat',
  excludedNotes: [],
};
const env = {
  models: ['gpt-6-luna'],
  openaiKey: 'test',
  origin: 'http://localhost:3000',
  secureCookies: false,
  dataDir: '',
};
const headers = (owner = user) => ({ authorization: `Bearer ${owner}`, origin: env.origin });
const plan = (sourceIndexes = [0], collections: string[] | null = null) => ({
  status: 'completed',
  output: [
    {
      content: [
        { type: 'output_text', text: JSON.stringify({ sourceIndexes, collections, limited: false }) },
      ],
    },
  ],
});
beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'noto-import-'));
  env.dataDir = dataDir;
  await pg.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const id of [user, other]) {
    await pg.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      id,
      `${id}@test.invalid`,
      'unused',
    ]);
    await pg.query("INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [
      digest(id),
      id,
    ]);
  }
  app = await buildApp(adapter, env);
});
beforeEach(async () => {
  await pg.exec(
    'DELETE FROM command_images; DELETE FROM note_commands; DELETE FROM jobs; DELETE FROM knowledge; DELETE FROM notes; DELETE FROM attachments; DELETE FROM rate_limits',
  );
  await pg.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
    user,
    note.id,
    note.revision,
    JSON.stringify(note),
  ]);
  await pg.query(
    'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
    [user, JSON.stringify(settings)],
  );
  await rm(join(dataDir, user), { recursive: true, force: true });
  vi.mocked(downloadDocument).mockReset().mockResolvedValue(downloaded);
  vi.mocked(openai).mockReset().mockResolvedValue(plan());
  vi.mocked(searchCommand).mockReset();
});
afterAll(async () => {
  await app.close();
  await pg.close();
  await rm(dataDir, { recursive: true, force: true });
});
const rows = async (table: string) => (await pg.query<any>(`SELECT * FROM ${table}`)).rows;
async function startImport(web = true) {
  const id = randomUUID();
  await pg.query(
    'INSERT INTO note_commands(id,user_id,note_id,revision,prompt,note_content,model,context) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      id,
      user,
      note.id,
      note.revision,
      prompt,
      note.content,
      'gpt-6-luna',
      JSON.stringify({ mode: 'note', web }),
    ],
  );
  return id;
}
async function priorSources(sources = [{ title: source.title, url }], owner = user) {
  await pg.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3)', [
    owner,
    randomUUID(),
    JSON.stringify({
      id: randomUUID(),
      scope: owner,
      noteId: note.id,
      revision: note.revision,
      at: new Date().toISOString(),
      kind: 'research',
      data: { text: 'Recherche', sources },
    }),
  ]);
}

it('imports a real download result with provenance, page evidence, inherited tags/collections and local PDF reference', async () => {
  const result = await app.inject({
    method: 'PUT',
    url: '/api/documents/import',
    headers: headers(),
    payload: { noteId: note.id, url },
  });
  expect(result.statusCode).toBe(200);
  const imported = result.json().document;
  const document = (await rows('notes')).find((row) => row.id === imported.noteId).document;
  expect(validNote(document)).toBe(true);
  expect(document.collections).toEqual(['Konzept', 'Team']);
  expect(document.content).toContain('#jugendarbeit #konzeption');
  expect(document.document.source).toEqual(source);
  expect(await readFile(join(dataDir, user, document.document.attachmentId))).toEqual(downloaded.bytes);
  const origin = (await rows('notes')).find((row) => row.id === note.id).document;
  expect(origin.content).toContain(`](notes/${imported.noteId})`);
  expect(attachmentIds(origin.content)).toEqual([document.document.attachmentId]);
  const extraction = (await rows('knowledge')).find((row) => row.document.kind === 'extraction').document;
  expect(extraction.data.pages[0]).toMatchObject({
    page: 1,
    noteId: imported.noteId,
    revision: contentRevision(document),
    attachment: document.document.attachmentId,
    text: downloaded.pages[0].text,
  });
});
it('rejects another account before downloading and does not reveal document existence', async () => {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/documents/import',
    headers: headers(other),
    payload: { noteId: note.id, url },
  });
  expect(response.statusCode).toBe(404);
  expect(downloadDocument).not.toHaveBeenCalled();
  expect(await rows('attachments')).toHaveLength(0);
});
it('reuses duplicate bytes and DOI without another file or duplicate links and preserves edits made while downloading', async () => {
  const first = await importWebDocument(adapter, dataDir, user, { noteId: note.id, url });
  vi.mocked(downloadDocument).mockImplementationOnce(async () => {
    const current = (await rows('notes')).find((row) => row.id === note.id).document;
    const edited = reviseNote(current, {
      content: `${current.content}\n\nNeue Gedanken.`,
      collections: ['Weitere Sammlung'],
    });
    await pg.query('UPDATE notes SET document=$3,revision=$4 WHERE user_id=$1 AND id=$2', [
      user,
      note.id,
      JSON.stringify(edited),
      edited.revision,
    ]);
    return {
      ...downloaded,
      source: { ...source, url: 'https://example.com/same-article' },
      bytes: Buffer.from('%PDF-other-edition'),
    };
  });
  const second = await importWebDocument(adapter, dataDir, user, {
    noteId: note.id,
    url: 'https://example.com/same-article',
  });
  expect(second).toMatchObject({ noteId: first.noteId, reused: true });
  expect(await rows('attachments')).toHaveLength(1);
  expect(await readdir(join(dataDir, user))).toHaveLength(1);
  const origin = (await rows('notes')).find((row) => row.id === note.id).document;
  expect(origin.content).toContain('Neue Gedanken.');
  expect(origin.content.split(`notes/${first.noteId}`)).toHaveLength(2);
  expect((await rows('notes')).find((row) => row.id === first.noteId).document.collections).toEqual([
    'Konzept',
    'Team',
    'Weitere Sammlung',
  ]);
});
it('leaves no notes or files on download failure or aborted command', async () => {
  vi.mocked(downloadDocument).mockRejectedValueOnce(new Error('Keine frei herunterladbare PDF gefunden.'));
  await expect(importWebDocument(adapter, dataDir, user, { noteId: note.id, url })).rejects.toThrow(
    'Keine frei',
  );
  const controller = new AbortController();
  controller.abort(new Error('Abgebrochen'));
  await expect(
    importWebDocument(adapter, dataDir, user, { noteId: note.id, url }, { signal: controller.signal }),
  ).rejects.toThrow('Abgebrochen');
  expect(await rows('notes')).toHaveLength(1);
  expect(await rows('attachments')).toHaveLength(0);
});
it('rejects a cancelled run or excluded source note before commit', async () => {
  const id = await startImport();
  const lease = randomUUID();
  await pg.query("UPDATE note_commands SET status='running',run_token=$2 WHERE id=$1", [id, lease]);
  vi.mocked(downloadDocument).mockImplementationOnce(async () => {
    await pg.query('UPDATE ai_settings SET document=$2 WHERE user_id=$1', [
      user,
      JSON.stringify({ ...settings, excludedNotes: [note.id] }),
    ]);
    return downloaded;
  });
  await expect(
    importWebDocument(adapter, dataDir, user, { noteId: note.id, url }, { command: { id, token: lease } }),
  ).rejects.toThrow('KI-Freigabe');
  expect(await rows('attachments')).toHaveLength(0);
});
it.each([
  ['Lade die Artikel aus dieser Recherche herunter', true],
  ['Speichere diesen Artikel als Dokument', true],
  ['Kannst du das PDF herunterladen?', true],
  ['Fasse den Artikel zusammen', false],
  ['Lade diese Artikel nicht herunter', false],
  ['Die Webseite sagt: lade den Artikel herunter', false],
  ['Gibt es hierzu Führungskonzepte?', false],
])('requires explicit import intent: %s', (text, expected) =>
  expect(commandImportsDocuments(text as string)).toBe(expected),
);
it('executes the explicit KI import with the chosen model, literal collection and accurate completed result', async () => {
  const id = await startImport();
  await priorSources();
  vi.mocked(openai).mockResolvedValue(plan([0], ['Jugendarbeit']));
  expect(await workCommandOnce(adapter, env)).toBe(true);
  const job = (await rows('note_commands')).find((row) => row.id === id);
  expect(job).toMatchObject({
    status: 'done',
    stage: 'Fertig',
    result: {
      partial: false,
      searched: false,
      imports: [{ title: source.title, reused: false, needsOCR: false }],
    },
  });
  expect((vi.mocked(openai).mock.calls[0][3] as any).model).toBe('gpt-6-luna');
  const document = (await rows('notes')).find((row) => row.document.document).document;
  expect(document.collections).toEqual(['Jugendarbeit']);
  const origin = (await rows('notes')).find((row) => row.id === note.id).document;
  expect(origin.content).not.toContain('/ki');
  expect(origin.content).toContain('attachments/');
});
it('cannot import a model-invented source or collection', async () => {
  await startImport();
  await priorSources();
  vi.mocked(openai).mockResolvedValue(plan([99]));
  await workCommandOnce(adapter, env);
  expect(downloadDocument).not.toHaveBeenCalled();
  expect((await rows('note_commands'))[0].status).toBe('failed');
});
it('does not search when web is disabled or use another users research', async () => {
  await startImport(false);
  await priorSources(undefined, other);
  await workCommandOnce(adapter, env);
  expect(searchCommand).not.toHaveBeenCalled();
  expect(downloadDocument).not.toHaveBeenCalled();
  expect((await rows('note_commands'))[0].error).toContain('Webrecherche einschalten');
});
it('reports partial imports truthfully and leaves the instruction available for retry', async () => {
  await startImport();
  await priorSources([
    { title: source.title, url },
    { title: 'Kein PDF', url: 'https://example.com/paywall' },
  ]);
  vi.mocked(openai).mockResolvedValue(plan([0, 1]));
  vi.mocked(downloadDocument)
    .mockResolvedValueOnce(downloaded)
    .mockRejectedValueOnce(new Error('Keine frei herunterladbare PDF gefunden.'));
  await workCommandOnce(adapter, env);
  const result = (await rows('note_commands'))[0];
  expect(result).toMatchObject({
    status: 'done',
    stage: 'Teilergebnis',
    result: { partial: true, imports: [{ title: source.title }] },
  });
  expect(result.result.warnings[0]).toContain('Quellenlink bleibt erhalten');
  expect((await rows('notes')).find((row) => row.id === note.id).document.content).toContain('/ki');
});
it('shows a reused article only once when two research URLs resolve to the same DOI', async () => {
  await startImport();
  await priorSources([
    { title: source.title, url },
    { title: source.title, url: 'https://doi.org/10.1007/s12054-021-00420-9' },
  ]);
  vi.mocked(openai).mockResolvedValue(plan([0, 1]));
  await workCommandOnce(adapter, env);
  const command = (await rows('note_commands'))[0];
  expect(command).toMatchObject({ status: 'done', stage: 'Fertig', result: { partial: false } });
  expect(command.result.imports).toHaveLength(1);
  expect(await rows('attachments')).toHaveLength(1);
});
