import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { repo, mutateStored } from './repository';
import { allAttachmentIds, conflictCopy, validNote, type Note, type Scope } from './domain';
import { createNottoClient } from './backend';

export interface CloudConfig {
  url: string;
  key: string;
}
export function readCloudConfig(): CloudConfig {
  try {
    return (
      JSON.parse(localStorage.getItem('notto-cloud') || 'null') || {
        url:
          import.meta.env.VITE_NOTTO_SERVER_URL ||
          (import.meta.env.MODE === 'test'
            ? ''
            : import.meta.env.DEV
              ? window.location.origin
              : 'https://noto-app.de'),
        key: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      }
    );
  } catch {
    return { url: '', key: '' };
  }
}
export function configured(): boolean {
  const c = readCloudConfig();
  return Boolean(c.url);
}
export function ownBackend() {
  const c = readCloudConfig();
  return Boolean(c.url && !c.key);
}
let client: SupabaseClient | null = null;
export function cloud(): SupabaseClient | null {
  if (client) return client;
  const c = readCloudConfig();
  if (!c.url) return null;
  try {
    if (!c.key) {
      client = createNottoClient(c.url);
      return client;
    }
    client = createClient(c.url, c.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return client;
  } catch {
    return null;
  }
}
export function saveCloudConfig(config: CloudConfig) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    throw new Error('Bitte eine HTTPS-Projekt-URL verwenden.');
  if (config.key.startsWith('sb_secret_'))
    throw new Error('Hier darf nur der öffentliche Publishable-/Anon-Key eingetragen werden.');
  try {
    const part = config.key.split('.')[1];
    if (part && JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role')
      throw new Error('Service-Role-Keys dürfen nicht in die App.');
  } catch (e) {
    if (e instanceof Error && e.message.includes('Service-Role')) throw e;
  }
  localStorage.setItem('notto-cloud', JSON.stringify(config));
  client = null;
}
function remoteDocument(note: Note) {
  const { scope: _scope, baseRevision: _base, dirty: _dirty, ...document } = note;
  return document;
}
function localDocument(document: unknown, scope: Scope): Note {
  if (!validNote(document))
    throw new Error('Die Cloud enthält eine ungültige Notiz. Es wurde nichts überschrieben.');
  return { ...document, scope, baseRevision: document.revision, dirty: false };
}
async function uploadAttachments(c: SupabaseClient, note: Note) {
  for (const id of allAttachmentIds(note)) {
    const a = await repo.attachment(note.scope, id);
    if (!a) throw new Error(`Bild ${id} fehlt lokal. Synchronisation dieser Notiz angehalten.`);
    const { error } = await c.storage
      .from('attachments')
      .upload(`${note.scope}/${id}`, a.bytes, { contentType: a.mime, upsert: false });
    if (
      error &&
      !['409', 'Duplicate'].includes(String((error as { statusCode?: string }).statusCode)) &&
      !/already exists|duplicate/i.test(error.message)
    )
      throw error;
  }
}
export async function fetchAttachment(scope: Scope, id: string) {
  const existing = await repo.attachment(scope, id);
  if (existing) return existing;
  const c = cloud();
  if (!c || scope === 'local') return undefined;
  const { data, error } = await c.storage.from('attachments').download(`${scope}/${id}`);
  if (error) throw error;
  const a = { scope, id, name: id, mime: data.type, bytes: new Uint8Array(await data.arrayBuffer()) };
  await repo.putAttachment(a);
  return a;
}
const running = new Map<string, Promise<number>>();
export function syncNotes(scope: Scope): Promise<number> {
  const existing = running.get(scope);
  if (existing) return existing;
  const promise = performSync(scope).finally(() => {
    running.delete(scope);
  });
  running.set(scope, promise);
  return promise;
}
async function performSync(scope: Scope): Promise<number> {
  const c = cloud();
  if (!c || scope === 'local') return 0;
  const {
    data: { user },
    error: authError,
  } = await c.auth.getUser();
  if (authError) throw authError;
  if (user?.id !== scope) throw new Error('Bitte erneut anmelden.');
  let conflicts = 0;
  for (const pending of (await repo.list(scope)).filter((n) => n.dirty)) {
    await uploadAttachments(c, pending);
    const { data, error } = await c.rpc('push_note', {
      p_id: pending.id,
      p_revision: pending.revision,
      p_base_revision: pending.baseRevision,
      p_document: remoteDocument(pending),
    });
    if (error) throw error;
    if (data.accepted) {
      await mutateStored(scope, pending.id, (n) => {
        if (
          n.baseRevision !== pending.baseRevision &&
          n.baseRevision !== pending.revision &&
          n.revision !== pending.revision
        )
          return n;
        return { ...n, baseRevision: pending.revision, dirty: n.revision !== pending.revision };
      });
    } else {
      const current = await repo.get(scope, pending.id);
      if (!current) continue;
      // A newer local edit remains pending; retry it on the next pass.
      if (current.revision !== pending.revision) continue;
      const remote = localDocument(data.document, scope);
      for (const id of allAttachmentIds(remote)) await fetchAttachment(scope, id);
      const copy = conflictCopy(current);
      await repo.put(copy, null);
      await repo.put(remote, current.revision);
      conflicts++;
    }
  }
  // Paginate explicitly: PostgREST limits the number of returned rows.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await c
      .from('notes')
      .select('document')
      .order('id')
      .range(offset, offset + 499);
    if (error) throw error;
    for (const row of data) {
      const remote = localDocument(row.document, scope);
      const local = await repo.get(scope, remote.id);
      if (local?.dirty || local?.revision === remote.revision) continue;
      // Cache all image versions before accepting a cloud revision for offline use.
      for (const id of allAttachmentIds(remote)) await fetchAttachment(scope, id);
      try {
        await repo.put(remote, local?.revision ?? null);
      } catch {
        /* Another window saved meanwhile. Keep the local edit. */
      }
    }
    if (data.length < 500) break;
  }
  return conflicts;
}
