import { memorySchema } from '../src/memory-policy.js';
import { organizationRecordSchema, organizationDecisionSchema } from '../src/agent-policy.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './database.js';
import { limit } from './database.js';
import { digest, hashPassword, verifyPassword, token } from './security.js';
import { openai, type AIEnvironment } from './openai.js';
import { selectableModels } from './models.js';
import { validNote } from '../src/domain.js';
declare module 'fastify' {
  interface FastifyRequest {
    nottoUser: { id: string; email: string } | null;
    sessionHash: string | null;
  }
}
export interface Environment extends AIEnvironment {
  origin: string;
  dataDir: string;
  staticDir?: string;
  secureCookies: boolean;
}
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(12).max(256),
  invite: z.string().max(256).optional(),
});
const uuid = z.string().uuid();
const attachmentId = z.string().regex(/^[a-f0-9-]{36}\.(png|jpg|webp|gif|avif|pdf)$/);
const fail = (message: string, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};
export async function buildApp(db: Database, env: Environment) {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024, logger: false, trustProxy: false });
  app.decorateRequest('nottoUser', null);
  app.decorateRequest('sessionHash', null);
  const origins = new Set([
    env.origin,
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ]);
  if (!env.secureCookies) {
    origins.add('http://127.0.0.1:1420');
    origins.add('http://localhost:1420');
  }
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Notto-Client'],
  });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as Error & { statusCode?: number };
    const status = error instanceof z.ZodError ? 400 : e.statusCode || 500;
    reply.code(status).send({ error: status === 500 ? 'Serverfehler. Bitte erneut versuchen.' : e.message });
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
      );
    return payload;
  });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return;
    if (req.headers.origin && !origins.has(req.headers.origin)) fail('Nicht erlaubter Ursprung', 403);
    const value = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : req.cookies.notto_session;
    if (value) {
      const hash = digest(value);
      const result = await db.query(
        'SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now()',
        [hash],
      );
      req.nottoUser = result.rows[0] || null;
      req.sessionHash = hash;
    }
    if (
      !['/api/health', '/api/auth/login', '/api/auth/register', '/api/auth/session'].includes(
        req.url.split('?')[0],
      ) &&
      !req.nottoUser
    )
      fail('Bitte anmelden.', 401);
    if (!['GET', 'HEAD'].includes(req.method) && !req.headers.authorization && !req.headers.origin)
      fail('Ursprung der Anfrage fehlt.', 403);
  });
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, version: '0.13.15' };
  });
  app.get('/api/auth/session', async (req) => ({ user: req.nottoUser }));
  const loginResult = async (
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    user: { id: string; email: string },
  ) => {
    const secret = token();
    await db.query("INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [
      digest(secret),
      user.id,
    ]);
    reply.setCookie('notto_session', secret, {
      httpOnly: true,
      secure: env.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });
    return { user, ...(req.headers['x-notto-client'] === 'desktop' ? { token: secret } : {}) };
  };
  app.post('/api/auth/register', async (req, reply) => {
    await limit(db, `register:${req.ip}`, 10, 3600);
    const p = credentials.parse(req.body);
    if (!p.invite) fail('Einrichtungscode erforderlich.', 403);
    const hash = await hashPassword(p.password),
      client = await db.connect();
    let user;
    try {
      await client.query('BEGIN');
      const invitation = await client.query(
        'UPDATE invitations SET used_at=now() WHERE hash=$1 AND email=$2 AND used_at IS NULL RETURNING email',
        [digest(p.invite!), p.email],
      );
      if (!invitation.rowCount) fail('Einrichtungscode ungültig oder bereits verwendet.', 403);
      user = { id: randomUUID(), email: p.email };
      await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
        user.id,
        user.email,
        hash,
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return loginResult(req, reply, user!);
  });
  app.post('/api/auth/login', async (req, reply) => {
    await limit(db, `login-ip:${req.ip}`, 100, 900);
    const p = credentials.parse(req.body);
    await limit(db, `login-email:${digest(p.email)}`, 15, 900);
    const { rows } = await db.query('SELECT id,email,password_hash FROM users WHERE email=$1', [p.email]);
    const hash = rows[0]?.password_hash || 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
    if (!(await verifyPassword(p.password, hash)) || !rows[0])
      fail('E-Mail oder Passwort stimmt nicht.', 401);
    return loginResult(req, reply, { id: rows[0].id, email: rows[0].email });
  });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionHash) await db.query('DELETE FROM sessions WHERE hash=$1', [req.sessionHash]);
    reply.clearCookie('notto_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/notes', async (req) => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return {
      data: (
        await db.query('SELECT document FROM notes WHERE user_id=$1 ORDER BY id LIMIT 500 OFFSET $2', [
          req.nottoUser!.id,
          offset,
        ])
      ).rows,
    };
  });
  app.post('/api/notes/push', async (req) => {
    const p = z
      .object({ p_id: uuid, p_revision: uuid, p_base_revision: uuid.nullable(), p_document: z.unknown() })
      .parse(req.body);
    if (!validNote(p.p_document) || p.p_document.id !== p.p_id || p.p_document.revision !== p.p_revision)
      fail('Ungültige Notiz.');
    const user = req.nottoUser!.id,
      client = await db.connect();
    try {
      await client.query('BEGIN');
      const document = JSON.stringify(p.p_document);
      const accepted =
        p.p_base_revision === null
          ? await client.query(
              'INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
              [user, p.p_id, p.p_revision, document],
            )
          : await client.query(
              'UPDATE notes SET revision=$3,document=$4,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$5 RETURNING id',
              [user, p.p_id, p.p_revision, document, p.p_base_revision],
            );
      const { rows } = await client.query('SELECT document,revision FROM notes WHERE user_id=$1 AND id=$2', [
        user,
        p.p_id,
      ]);
      if (accepted.rowCount) {
        await client.query(
          'INSERT INTO jobs(id,user_id,note_id,revision) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [randomUUID(), user, p.p_id, p.p_revision],
        );
      }
      await client.query('COMMIT');
      if (accepted.rowCount || rows[0]?.revision === p.p_revision) return { accepted: true };
      if (!rows[0]) fail('Serverfassung fehlt; lokale Fassung bleibt erhalten.', 409);
      return { accepted: false, document: rows[0].document };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
  app.put('/api/attachments/:id', async (req) => {
    const id = attachmentId.parse((req.params as { id: string }).id),
      p = z
        .object({
          name: z.string().max(255),
          mime: z.enum([
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'image/avif',
            'application/pdf',
          ]),
          base64: z.string().max(17 * 1024 * 1024),
        })
        .parse(req.body);
    const bytes = Buffer.from(p.base64, 'base64');
    if (bytes.length > 12 * 1024 * 1024) fail('Anhang zu groß.', 413);
    if (id.endsWith('.pdf') && (p.mime !== 'application/pdf' || bytes.subarray(0, 5).toString() !== '%PDF-'))
      fail('Ungültiges PDF.');
    const user = req.nottoUser!.id,
      checksum = digest(bytes),
      dir = join(env.dataDir, user);
    await mkdir(dir, { recursive: true });
    const path = join(dir, id);
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (digest(await readFile(path)) !== checksum) fail('Anhang-ID enthält bereits andere Daten.', 409);
    }
    await db.query(
      'INSERT INTO attachments(user_id,id,name,mime,sha256,size) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [user, id, p.name, p.mime, checksum, bytes.length],
    );
    return { ok: true };
  });
  app.get('/api/attachments/:id', async (req, reply) => {
    const id = attachmentId.parse((req.params as { id: string }).id),
      user = req.nottoUser!.id;
    const { rows } = await db.query('SELECT name,mime FROM attachments WHERE user_id=$1 AND id=$2', [
      user,
      id,
    ]);
    if (!rows[0]) fail('Anhang nicht gefunden.', 404);
    return reply
      .type(rows[0].mime)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`)
      .send(await readFile(join(env.dataDir, user, id)));
  });
  app.get('/api/knowledge', async (req) => {
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return {
      data: (
        await db.query('SELECT document FROM knowledge WHERE user_id=$1 ORDER BY id LIMIT 500 OFFSET $2', [
          req.nottoUser!.id,
          offset,
        ])
      ).rows,
    };
  });
  app.post('/api/knowledge', async (req) => {
    const records = z
      .array(
        z.object({
          id: uuid,
          scope: uuid,
          kind: z.enum([
            'analysis',
            'decision',
            'extraction',
            'research',
            'embedding',
            'manual-task',
            'collection',
            'memory',
            'organization',
            'organization-decision',
            'agent-run',
          ]),
          noteId: uuid,
          revision: uuid,
          at: z.string().datetime(),
          data: z.unknown(),
        }),
      )
      .max(50)
      .parse(req.body);
    for (const r of records) {
      if (r.scope !== req.nottoUser!.id) fail('Falsches Notizbuch.', 403);
      if (r.kind === 'memory') memorySchema.parse(r.data);
      if (r.kind === 'organization') organizationRecordSchema.parse(r.data);
      if (r.kind === 'organization-decision') organizationDecisionSchema.parse(r.data);
      if (r.kind === 'collection') z.object({ name: z.string().trim().min(1).max(60) }).parse(r.data);
      await db.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
        req.nottoUser!.id,
        r.id,
        JSON.stringify(r),
      ]);
    }
    return { ok: true };
  });
  app.get('/api/ai/models', async (req) => {
    await limit(db, `models:${req.nottoUser!.id}`, 60, 3600);
    return { models: await selectableModels(env) };
  });
  app.get('/api/ai/settings', async (req) => ({
    config:
      (await db.query('SELECT document FROM ai_settings WHERE user_id=$1', [req.nottoUser!.id])).rows[0]
        ?.document || null,
    configured: Boolean(env.openaiKey),
  }));
  app.put('/api/ai/settings', async (req) => {
    const document = z
      .object({
        enabled: z.boolean(),
        auto: z.boolean(),
        autoResearch: z.boolean().default(false),
        rewriteMode: z.enum(['correct', 'formulate']).default('correct'),
        model: z.string().max(100),
        excludedTags: z.string().max(2000),
        excludedNotes: z.array(uuid).max(10000),
      })
      .parse(req.body);
    await db.query(
      'INSERT INTO ai_settings(user_id,document) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document',
      [req.nottoUser!.id, JSON.stringify(document)],
    );
    if (document.enabled && document.auto)
      await db.query(
        "UPDATE jobs SET status='pending',attempts=0,available_at=now() WHERE user_id=$1 AND (status IN ('skipped','failed') OR (kind='analysis' AND status='done'))",
        [req.nottoUser!.id],
      );
    return { ok: true };
  });
  app.get('/api/ai/jobs', async (req) => ({
    jobs: (
      await db.query(
        "SELECT id,note_id,revision,kind,status,error,created_at,available_at FROM jobs WHERE user_id=$1 AND (status IN ('pending','running') OR id IN (SELECT id FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50)) ORDER BY created_at DESC",
        [req.nottoUser!.id],
      )
    ).rows,
  }));
  app.post('/api/ai', async (req) => {
    const p = z.object({ endpoint: z.string(), body: z.record(z.string(), z.unknown()) }).parse(req.body);
    const settings = (
      await db.query('SELECT document FROM ai_settings WHERE user_id=$1', [req.nottoUser!.id])
    ).rows[0]?.document;
    if (!settings?.enabled) fail('KI zuerst für dieses Notizbuch aktivieren.', 403);
    return openai(db, req.nottoUser!.id, p.endpoint, p.body, env);
  });
  if (env.staticDir) {
    await app.register(staticFiles, { root: resolve(env.staticDir) });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Nicht gefunden' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
