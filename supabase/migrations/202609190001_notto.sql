-- Run once in your Supabase SQL editor (or via `supabase db push`).
-- Every query and private file is scoped to the signed-in user.
create table public.notes (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id uuid not null,
  revision uuid not null,
  document jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint document_identity check (document->>'id' = id::text and document->>'revision' = revision::text),
  constraint document_size check (octet_length(document::text) < 10485760)
);
alter table public.notes enable row level security;
create policy "Own notes only" on public.notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.notes to authenticated;
revoke all on public.notes from anon;

-- A conditional UPDATE is atomic. A stale client receives the server version,
-- and keeps its own version as a separate conflict copy before replacing it.
create or replace function public.push_note(p_id uuid, p_revision uuid, p_base_revision uuid, p_document jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare existing jsonb; accepted boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_base_revision is null then
    insert into public.notes(user_id,id,revision,document)
      values(auth.uid(),p_id,p_revision,p_document)
      on conflict (user_id,id) do nothing returning true into accepted;
  else
    update public.notes set revision=p_revision,document=p_document,updated_at=now()
      where user_id=auth.uid() and id=p_id and revision=p_base_revision
      returning true into accepted;
  end if;
  if coalesce(accepted,false) then return jsonb_build_object('accepted',true); end if;
  select document into existing from public.notes where user_id=auth.uid() and id=p_id;
  -- An upload may have succeeded before the network response was lost.
  if existing->>'revision' = p_revision::text then return jsonb_build_object('accepted',true); end if;
  if existing is null then raise exception 'Remote note was removed; local copy retained'; end if;
  return jsonb_build_object('accepted',false,'document',existing);
end $$;
revoke all on function public.push_note(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.push_note(uuid,uuid,uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('attachments','attachments',false,12582912,array['image/png','image/jpeg','image/webp','image/gif','image/avif'])
on conflict(id) do nothing;
create policy "Read own attachments" on storage.objects for select to authenticated
  using (bucket_id='attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Upload own attachments" on storage.objects for insert to authenticated
  with check (bucket_id='attachments' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Attachments are immutable. No update/delete permissions: older revisions stay readable.
