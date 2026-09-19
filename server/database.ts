import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { digest } from './security.js';
export type Database = Pick<Pool, 'query' | 'connect'>;
export async function migrate(db: Database, invite?: { token: string; email: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(78234201)');
    await client.query(await readFile(new URL('../../server/schema.sql', import.meta.url), 'utf8'));
    if (invite)
      await client.query('INSERT INTO invitations(hash,email) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        digest(invite.token),
        invite.email.toLowerCase(),
      ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function limit(db: Database, key: string, max: number, seconds: number) {
  const bucket = Math.floor(Date.now() / 1000 / seconds);
  const { rowCount } = await db.query(
    'INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,1) ON CONFLICT(key,bucket) DO UPDATE SET count=rate_limits.count+1 WHERE rate_limits.count<$3 RETURNING count',
    [key, bucket, max],
  );
  if (!rowCount)
    throw Object.assign(new Error('Zu viele Anfragen. Bitte später erneut versuchen.'), { statusCode: 429 });
}
