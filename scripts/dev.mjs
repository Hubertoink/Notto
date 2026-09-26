import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { loadEnvFile } from 'node:process';

if (process.env.NODE_ENV === 'production') throw new Error('Testserver nur für lokale Entwicklung.');
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
try {
  loadEnvFile('.notto-dev/ai.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await new Promise((done, reject) => {
  const build = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'], {
    stdio: 'inherit',
  });
  build.on('error', reject);
  build.on('exit', (code) => (code === 0 ? done() : reject(new Error('Server-Build fehlgeschlagen.'))));
});
const { buildApp } = await import('../build-server/server/app.js');
const { hashPassword } = await import('../build-server/server/security.js');
const { newNote } = await import('../build-server/src/domain.js');
const dir = resolve(process.env.NOTTO_DEV_DIR || '.notto-dev');
await mkdir(dir, { recursive: true });
const pg = new PGlite(resolve(dir, 'database'));
await pg.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));

// PGlite uses a single connection. Hold it for the entire transaction.
let pending = Promise.resolve();
async function acquire() {
  const previous = pending;
  let release;
  pending = new Promise((done) => {
    release = done;
  });
  await previous;
  return release;
}
const query = async (text, args) => {
  const result = await pg.query(text, args);
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
};
const db = {
  async query(text, args) {
    const release = await acquire();
    try {
      return await query(text, args);
    } finally {
      release();
    }
  },
  async connect() {
    const release = await acquire();
    return { query, release };
  },
};
const credentialsPath = resolve(dir, 'test-account.json');
let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = { email: 'test@noto.local', password: randomBytes(15).toString('base64url') };
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}
const existing = await db.query('SELECT id FROM users WHERE email=$1', [credentials.email]);
if (!existing.rows.length) {
  const id = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    id,
    credentials.email,
    await hashPassword(credentials.password),
  ]);
  for (const text of [
    'Jugendhaus planen\n\nIdeen für den offenen Treff sammeln.\n#jugendhaus #jugendarbeit #planung',
    'Medienworkshop\n\nGemeinsam einen kurzen Film drehen.\n#jugendarbeit #medien #technologie',
    'Spieleabend\n\nNeue Spiele für den Freitag auswählen.\n#jugendhaus #spiele',
    'Konzeption\n\nZiele für das nächste Halbjahr besprechen.\n#konzeption #planung',
  ]) {
    const note = newNote(id, text);
    await db.query('INSERT INTO notes(user_id,id,revision,document) VALUES($1,$2,$3,$4)', [
      id,
      note.id,
      note.revision,
      JSON.stringify(note),
    ]);
  }
}
const environment = {
  origin: 'http://127.0.0.1:1420',
  dataDir: resolve(dir, 'attachments'),
  secureCookies: false,
  models: [],
  openaiKey: process.env.OPENAI_API_KEY,
};
const app = await buildApp(db, environment);
await app.listen({ host: '127.0.0.1', port: 3001 });
console.log(
  `Lokales Testkonto: ${credentials.email}\nZugangsdaten: ${credentialsPath}\nTestdaten bleiben in .notto-dev/. KI ${environment.openaiKey ? 'ist für die Dev-Instanz eingerichtet' : 'ist lokal nicht eingerichtet'}.`,
);
const { workOnce } = await import('../build-server/server/worker.js');
let working = false;
const worker = setInterval(async () => {
  if (working || !environment.openaiKey) return;
  working = true;
  try {
    await workOnce(db, environment);
  } catch (error) {
    console.error('Dev-Worker:', error instanceof Error ? error.name : 'Fehler');
  } finally {
    working = false;
  }
}, 3000);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(worker);
  vite.kill();
  await app.close();
  await pg.close();
  process.exit(code);
}
vite.on('error', (error) => {
  console.error(error);
  void stop(1);
});
vite.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
