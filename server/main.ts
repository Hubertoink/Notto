import { Pool } from 'pg';
import { migrate } from './database.js';
import { buildApp, type Environment } from './app.js';
import { workOnce } from './worker.js';
import { queueExistingRelations } from './note-relations.js';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL fehlt.');
const db = new Pool({ connectionString: databaseUrl, max: 5 });
const env: Environment = {
  origin: process.env.APP_ORIGIN || 'https://noto-app.de',
  dataDir: process.env.DATA_DIR || '/data/attachments',
  staticDir: process.env.STATIC_DIR || 'dist',
  secureCookies: process.env.NODE_ENV === 'production',
  openaiKey: process.env.OPENAI_API_KEY,
  models: (process.env.OPENAI_MODELS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
};
await migrate(
  db,
  process.env.SETUP_INVITE_TOKEN && process.env.SETUP_EMAIL
    ? { token: process.env.SETUP_INVITE_TOKEN, email: process.env.SETUP_EMAIL }
    : undefined,
);
if (process.env.NOTTO_ROLE === 'worker') {
  await queueExistingRelations(db);
  let stopping = false;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      await workOnce(db, env);
    } catch (e) {
      console.error('Worker database error', e instanceof Error ? e.name : 'Error');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  await db.end();
} else {
  const app = await buildApp(db, env);
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      void app.close().then(() => db.end());
    });
  const cleanup = setInterval(() => {
    void db
      .query('DELETE FROM sessions WHERE expires_at<now(); DELETE FROM rate_limits WHERE expires_at<now()')
      .catch(() => {});
  }, 86400000);
  cleanup.unref();
}
