-- 10xbnb board. Run once in the Supabase SQL editor, as the project owner.
-- Then turn off email signups in Authentication. The hook below is the second lock.
-- It does nothing until Authentication → Hooks → Before user created points at it.

create schema if not exists private;

create table if not exists private.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (name in ('levi', 'lon', 'backup'))
);

alter table private.members enable row level security;
revoke all on schema private from public, anon;
revoke all on table private.members from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.role_of()
returns text
language sql
stable
security definer
set search_path = private
as $$
  select name from private.members where user_id = auth.uid()
$$;

create or replace function private.can_read()
returns boolean
language sql
stable
security definer
set search_path = private
as $$
  select private.role_of() in ('levi', 'lon', 'backup')
$$;

create or replace function private.can_write()
returns boolean
language sql
stable
security definer
set search_path = private
as $$
  select private.role_of() in ('levi', 'lon')
$$;

revoke all on function private.role_of() from public, anon;
revoke all on function private.can_read() from public, anon;
revoke all on function private.can_write() from public, anon;
grant execute on function private.role_of() to authenticated;
grant execute on function private.can_read() to authenticated;
grant execute on function private.can_write() to authenticated;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  listing_title text not null check (char_length(listing_title) between 1 and 500),
  address text,
  city text,
  state text,
  zip text,
  listing_url text,
  report_url text,
  source_key text not null unique,
  source text,
  owner_name text,
  owner_phone text,
  owner_email text,
  beds smallint,
  baths numeric(3,1),
  starred boolean not null default false,
  status text not null default 'NEW' check (status in ('NEW','CONTACTED','PITCHED','SIGNED','NO')),
  last_contacted date,
  next_followup date,
  import_batch_id uuid
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  author_id uuid not null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  actor_id uuid,
  actor_name text,
  action text not null check (action in ('create','status','field','note','import')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists notes_property_idx on public.notes (property_id, created_at desc);
create index if not exists activity_property_idx on public.activity (property_id, created_at desc);

alter table public.properties enable row level security;
alter table public.notes enable row level security;
alter table public.activity enable row level security;

revoke all on public.properties, public.notes, public.activity from anon;
grant select, insert, update on public.properties to authenticated;
grant select, insert on public.notes to authenticated;
grant select on public.activity to authenticated;

drop policy if exists read_properties on public.properties;
drop policy if exists insert_properties on public.properties;
drop policy if exists update_properties on public.properties;
create policy read_properties on public.properties
  for select to authenticated using (private.can_read());
create policy insert_properties on public.properties
  for insert to authenticated with check (private.can_write());
create policy update_properties on public.properties
  for update to authenticated
  using (private.can_write()) with check (private.can_write());

drop policy if exists read_notes on public.notes;
drop policy if exists insert_notes on public.notes;
create policy read_notes on public.notes
  for select to authenticated using (private.can_read());
create policy insert_notes on public.notes
  for insert to authenticated with check (private.can_write());

drop policy if exists read_activity on public.activity;
create policy read_activity on public.activity
  for select to authenticated using (private.can_read());

revoke insert (created_by, updated_by, created_at, updated_at) on public.properties from authenticated;
revoke update (id, created_by, updated_by, created_at, updated_at, source_key) on public.properties from authenticated;
revoke insert (author_id, author_name, created_at) on public.notes from authenticated;

create or replace function private.stamp_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.id := gen_random_uuid();
    new.created_at := now();
    new.updated_at := now();
    new.created_by := who;
    new.updated_by := who;
    if new.source_key is null or new.source_key !~ '^[0-9a-f]{64}$' then
      new.source_key := md5(new.listing_title || '|' || gen_random_uuid()::text || clock_timestamp()::text);
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.source_key := old.source_key;
    new.updated_at := now();
    new.updated_by := who;
    if old.import_batch_id is not null then
      new.import_batch_id := old.import_batch_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.log_property()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  who uuid := auth.uid();
  name text := private.role_of();
  fields text[] := array[
    'listing_title','address','city','state','zip','listing_url','report_url',
    'owner_name','owner_phone','owner_email','beds','baths','starred',
    'last_contacted','next_followup','source'
  ];
  f text;
  oldv text;
  newv text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity (property_id, actor_id, actor_name, action, new_value)
    values (new.id, who, name, case when new.import_batch_id is null then 'create' else 'import' end, new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.activity (property_id, actor_id, actor_name, action, old_value, new_value)
    values (new.id, who, name, 'status', old.status, new.status);
  end if;
  foreach f in array fields loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then
      insert into public.activity (property_id, actor_id, actor_name, action, old_value, new_value)
      values (new.id, who, name, 'field', f || '=' || coalesce(oldv, ''), f || '=' || coalesce(newv, ''));
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.stamp_note()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  new.id := gen_random_uuid();
  new.author_id := auth.uid();
  new.author_name := coalesce(private.role_of(), 'member');
  new.created_at := now();
  new.body := btrim(new.body);
  if new.author_id is null or new.author_name not in ('levi', 'lon') then
    raise exception 'not a writer';
  end if;
  insert into public.activity (property_id, actor_id, actor_name, action, new_value)
  values (new.property_id, new.author_id, new.author_name, 'note', left(new.body, 200));
  return new;
end;
$$;

drop trigger if exists properties_stamp on public.properties;
create trigger properties_stamp
  before insert or update on public.properties
  for each row execute function private.stamp_property();

drop trigger if exists properties_log on public.properties;
create trigger properties_log
  after insert or update on public.properties
  for each row execute function private.log_property();

drop trigger if exists notes_stamp on public.notes;
create trigger notes_stamp
  before insert on public.notes
  for each row execute function private.stamp_note();

revoke all on function private.stamp_property() from public, anon, authenticated;
revoke all on function private.log_property() from public, anon, authenticated;
revoke all on function private.stamp_note() from public, anon, authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.properties;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notes;
  exception when duplicate_object then null;
  end;
end $$;

-- Rejects a public signup once this function is selected as the Before User Created hook.
-- Dashboard-created users do not pass through that hook. signup closed.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
as $$
begin
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'signup closed')
  );
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
do $$ begin
  grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
exception when undefined_object then null;
end $$;

-- After the two people exist in Authentication, one row each:
-- insert into private.members (user_id, name) values ('<levi uuid>', 'levi');
-- insert into private.members (user_id, name) values ('<lon uuid>', 'lon');
-- insert into private.members (user_id, name) values ('<backup uuid>', 'backup');
