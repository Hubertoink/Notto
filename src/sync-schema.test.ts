import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const pg = new PGlite();
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '20000000-0000-4000-8000-000000000002';
const id = '30000000-0000-4000-8000-000000000003';
const v1 = '40000000-0000-4000-8000-000000000004';
const v2 = '50000000-0000-4000-8000-000000000005';
const v3 = '60000000-0000-4000-8000-000000000006';
beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${alice}'),('${bob}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public,storage to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,name text,bucket_id text);
    alter table storage.objects enable row level security;
    grant select,insert on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;`);
  await pg.exec(
    readFileSync(new URL('../supabase/migrations/202609190001_notto.sql', import.meta.url), 'utf8'),
  );
  await pg.exec(
    readFileSync(new URL('../supabase/migrations/202609190002_intelligence.sql', import.meta.url), 'utf8'),
  );
}, 30000);
afterAll(async () => pg.close());
async function asUser(uid: string) {
  await pg.exec(`reset role; set request.jwt.claim.sub='${uid}'; set role authenticated;`);
}
async function push(revision: string, base: string | null, content: string) {
  return (
    await pg.query<{ result: { accepted: boolean; document?: { content: string } } }>(
      'select public.push_note($1,$2,$3,$4::jsonb) as result',
      [id, revision, base, JSON.stringify({ id, revision, content })],
    )
  ).rows[0].result;
}
describe.sequential('Postgres sync and access controls', () => {
  it('isolates append-only knowledge and enforces a server-side quota', async () => {
    await asUser(alice);
    await pg.query('insert into public.knowledge(id,document) values($1,$2)', [
      id,
      JSON.stringify({ id, scope: alice, kind: 'decision' }),
    ]);
    await expect(
      pg.query('update public.knowledge set document=$1 where id=$2', [
        JSON.stringify({ id, scope: alice }),
        id,
      ]),
    ).rejects.toThrow();
    await asUser(bob);
    expect((await pg.query('select * from public.knowledge')).rows).toHaveLength(0);
    await expect(
      pg.query('insert into public.knowledge(user_id,id,document) values($1,$2,$3)', [
        alice,
        v1,
        JSON.stringify({ id: v1, scope: alice }),
      ]),
    ).rejects.toThrow();
    await asUser(alice);
    for (let i = 0; i < 100; i++)
      expect(
        (await pg.query<{ allowed: boolean }>('select public.consume_ai_request() as allowed')).rows[0]
          .allowed,
      ).toBe(true);
    expect(
      (await pg.query<{ allowed: boolean }>('select public.consume_ai_request() as allowed')).rows[0].allowed,
    ).toBe(false);
  });
  it('accepts a new note and idempotent retries', async () => {
    await asUser(alice);
    expect((await push(v1, null, 'A')).accepted).toBe(true);
    expect((await push(v1, null, 'A')).accepted).toBe(true);
  });
  it('rejects a stale revision and returns the winning original', async () => {
    expect((await push(v2, v1, 'B')).accepted).toBe(true);
    const result = await push(v3, v1, 'C');
    expect(result.accepted).toBe(false);
    expect(result.document?.content).toBe('B');
  });
  it('does not expose notes from another account', async () => {
    await asUser(bob);
    expect((await pg.query('select * from public.notes')).rows).toHaveLength(0);
    expect((await push(v1, null, 'Bob')).accepted).toBe(true);
    await asUser(alice);
    expect(
      (await pg.query<{ document: { content: string } }>('select document from public.notes')).rows[0]
        .document.content,
    ).toBe('B');
  });
  it('rejects mismatched document identity', async () => {
    await expect(
      pg.query('select public.push_note($1,$2,$3,$4::jsonb)', [
        id,
        v3,
        v2,
        JSON.stringify({ id, revision: v1, content: 'bad' }),
      ]),
    ).rejects.toThrow();
  });
  it('only allows attachments inside the signed-in account folder', async () => {
    await pg.query('insert into storage.objects(name,bucket_id) values($1,$2)', [
      `${alice}/image.png`,
      'attachments',
    ]);
    await expect(
      pg.query('insert into storage.objects(name,bucket_id) values($1,$2)', [
        `${bob}/image.png`,
        'attachments',
      ]),
    ).rejects.toThrow();
    await asUser(bob);
    expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
  });
  it('blocks unauthenticated reads', async () => {
    await pg.exec('reset role; set role anon;');
    await expect(pg.query('select * from public.notes')).rejects.toThrow();
  });
});
