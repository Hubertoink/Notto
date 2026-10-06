import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { digest } from './security.js';
import { downloadDocument } from './document-download.js';
import { publicUrl } from './browser-network.js';
import {
  newNote,
  reviseNote,
  tagsOf,
  titleOf,
  contentRevision,
  validNote,
  type Note,
} from '../src/domain.js';
import { documentContent, safeLabel } from '../src/document-content.js';
import { noteAllowed } from '../src/evidence-policy.js';

export interface DocumentImportInput {
  noteId: string;
  url: string;
  title?: string;
  collections?: string[];
  tags?: string[];
}
export interface ImportedDocument {
  noteId: string;
  title: string;
  sourceUrl: string;
  reused: boolean;
  needsOCR: boolean;
}
export async function importWebDocument(
  db: Database,
  dataDir: string,
  user: string,
  input: DocumentImportInput,
  options: {
    signal?: AbortSignal;
    permitted?: () => Promise<unknown>;
    command?: { id: string; token: string };
  } = {},
): Promise<ImportedDocument> {
  publicUrl(input.url);
  const origin = (
    await db.query('SELECT document FROM notes WHERE user_id=$1 AND id=$2', [user, input.noteId])
  ).rows[0]?.document;
  if (!origin || origin.deleted)
    throw Object.assign(new Error('Ausgangsnotiz nicht gefunden.'), { statusCode: 404 });
  const downloaded = await downloadDocument(input.url, input.title, options.signal);
  await options.permitted?.();
  options.signal?.throwIfAborted();
  const checksum = digest(downloaded.bytes);
  const client = await db.connect();
  let newPath: string | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
    if (options.command) {
      const command = (
        await client.query(
          'SELECT status,run_token FROM note_commands WHERE user_id=$1 AND id=$2 FOR UPDATE',
          [user, options.command.id],
        )
      ).rows[0];
      if (command?.status !== 'running' || command.run_token !== options.command.token)
        throw new Error('Auftrag abgebrochen.');
      const settings = (await client.query('SELECT document FROM ai_settings WHERE user_id=$1', [user]))
        .rows[0]?.document;
      if (!settings?.enabled) throw new Error('Die KI-Freigabe wurde aufgehoben.');
    }
    const current: Note | undefined = (
      await client.query('SELECT document FROM notes WHERE user_id=$1 AND id=$2 FOR UPDATE', [
        user,
        input.noteId,
      ])
    ).rows[0]?.document;
    if (!current || current.deleted) throw new Error('Die Ausgangsnotiz ist nicht mehr verfügbar.');
    if (options.command) {
      const settings = (await client.query('SELECT document FROM ai_settings WHERE user_id=$1', [user]))
        .rows[0]?.document;
      if (!settings?.enabled || !noteAllowed(current, settings))
        throw new Error('Die KI-Freigabe für diese Notiz wurde aufgehoben.');
    }
    const existing = (
      await client.query(
        "SELECT n.document FROM notes n JOIN attachments a ON a.user_id=n.user_id AND a.id=n.document->'document'->>'attachmentId' WHERE n.user_id=$1 AND COALESCE((n.document->>'deleted')::boolean,false)=false AND (a.sha256=$2 OR n.document->'document'->'source'->>'url'=$3 OR ($4::text IS NOT NULL AND lower(n.document->'document'->'source'->>'doi')=lower($4))) ORDER BY n.updated_at LIMIT 1",
        [user, checksum, downloaded.source.url, downloaded.source.doi ?? null],
      )
    ).rows[0]?.document as Note | undefined;
    const inheritedTags = [...new Set([...tagsOf(current.content), ...(input.tags ?? [])])];
    const inheritedCollections = [...new Set(input.collections ?? current.collections ?? [])];
    let document: Note;
    if (existing?.document) {
      const addedTags = inheritedTags.filter((tag) => !tagsOf(existing.content).includes(tag));
      const collections = [...new Set([...(existing.collections ?? []), ...inheritedCollections])].slice(
        0,
        30,
      );
      let content = existing.content;
      if (addedTags.length)
        content = content.trimEnd() + '\n\n' + addedTags.map((tag) => `#${tag}`).join(' ');
      const source = existing.document.source ?? downloaded.source;
      if (!existing.document.source) {
        const provenance = documentContent(
          '',
          [],
          { id: existing.document.attachmentId, name: existing.document.name },
          source,
        ).split('\n\nQuelle: ')[1];
        content = content.trimEnd() + '\n\nQuelle: ' + provenance;
      }
      document =
        content === existing.content &&
        JSON.stringify(collections) === JSON.stringify(existing.collections ?? [])
          ? existing
          : reviseNote(existing, { content, collections, document: { ...existing.document, source } });
      if (document.revision !== existing.revision)
        await client.query(
          'UPDATE notes SET document=$3,revision=$4,updated_at=now() WHERE user_id=$1 AND id=$2',
          [user, document.id, JSON.stringify(document), document.revision],
        );
    } else {
      const attachmentId = `${randomUUID()}.pdf`;
      const filename = downloaded.source.title.replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').slice(0, 230) + '.pdf';
      document = {
        ...newNote(
          user,
          documentContent(
            downloaded.source.title,
            inheritedTags,
            { id: attachmentId, name: filename },
            downloaded.source,
          ),
        ),
        collections: inheritedCollections,
        document: {
          attachmentId,
          name: filename,
          mime: 'application/pdf',
          version: 1,
          source: downloaded.source,
        },
      };
      if (!validNote(document)) throw new Error('Die Artikelmetadaten sind ungültig.');
      const dir = join(dataDir, user);
      await mkdir(dir, { recursive: true });
      newPath = join(dir, attachmentId);
      await writeFile(newPath, downloaded.bytes, { flag: 'wx', mode: 0o600 });
      await client.query(
        'INSERT INTO attachments(user_id,id,name,mime,sha256,size) VALUES($1,$2,$3,$4,$5,$6)',
        [user, attachmentId, filename, 'application/pdf', checksum, downloaded.bytes.length],
      );
      await client.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
        user,
        document.id,
        document.revision,
        JSON.stringify(document),
      ]);
      const extraction = {
        id: randomUUID(),
        scope: user,
        noteId: document.id,
        revision: contentRevision(document),
        at: new Date().toISOString(),
        kind: 'extraction',
        data: {
          id: attachmentId,
          ocr: false,
          pages: downloaded.pages.map((page) => ({
            ...page,
            noteId: document.id,
            revision: contentRevision(document),
            attachment: attachmentId,
          })),
        },
      };
      await client.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3)', [
        user,
        extraction.id,
        JSON.stringify(extraction),
      ]);
    }
    if (
      document.id !== current.id &&
      (!current.content.includes(`notes/${document.id}`) ||
        !current.content.includes(`attachments/${document.document!.attachmentId}`))
    ) {
      // A local PDF reference makes the imported text available even in "this note and attachments" context.
      const links = [
        !current.content.includes(`notes/${document.id}`)
          ? `[${safeLabel(titleOf(document.content))}](notes/${document.id})`
          : '',
        !current.content.includes(`attachments/${document.document!.attachmentId}`)
          ? `[PDF](attachments/${document.document!.attachmentId})`
          : '',
      ].filter(Boolean);
      const reference = `\n\nQuelle: ${links.join(' · ')}`;
      const linked = reviseNote(current, { content: current.content.trimEnd() + reference });
      await client.query(
        'UPDATE notes SET document=$3,revision=$4,updated_at=now() WHERE user_id=$1 AND id=$2',
        [user, current.id, JSON.stringify(linked), linked.revision],
      );
      await client.query(
        'INSERT INTO jobs(id,user_id,note_id,revision) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [randomUUID(), user, current.id, linked.revision],
      );
    }
    options.signal?.throwIfAborted();
    await client.query('COMMIT');
    return {
      noteId: document.id,
      title: titleOf(document.content),
      sourceUrl: downloaded.source.url,
      reused: !!existing,
      needsOCR: downloaded.needsOCR,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (newPath) await unlink(newPath).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
