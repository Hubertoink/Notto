update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/avif','application/pdf'] where id='attachments';

-- Append-only knowledge events keep user decisions independent of model analyses.
create table public.knowledge (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  document jsonb not null,
  primary key(user_id,id),
  check(document->>'id'=id::text),
  check(document->>'scope'=user_id::text),
  check(octet_length(document::text)<10485760)
);
alter table public.knowledge enable row level security;
create policy "Read own knowledge" on public.knowledge for select to authenticated using(user_id=(select auth.uid()));
create policy "Append own knowledge" on public.knowledge for insert to authenticated with check(user_id=(select auth.uid()));
grant select,insert on public.knowledge to authenticated;
revoke all on public.knowledge from anon;

create table public.ai_usage(user_id uuid not null references auth.users(id) on delete cascade, day date not null, count integer not null, primary key(user_id,day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public,anon,authenticated;
create function public.consume_ai_request() returns boolean language plpgsql security definer set search_path='' as $$
declare result integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.ai_usage(user_id,day,count) values(auth.uid(),(now() at time zone 'utc')::date,1)
  on conflict(user_id,day) do update set count=public.ai_usage.count+1 where public.ai_usage.count<100
  returning count into result;
  return result is not null;
end $$;
revoke all on function public.consume_ai_request() from public,anon;
grant execute on function public.consume_ai_request() to authenticated;
