-- The sealed ledger. Run once in the Supabase SQL editor, as the project owner.
--
-- Any page can keep a room here. A room is an append-only list of sealed lines.
-- The page seals every line with its own key before it leaves the phone, and
-- names its room from that same key, so this table only ever holds noise and
-- nobody without the key can find a room. There is no update and no delete.

create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  room text not null check (length(room) = 43),
  at timestamptz not null default now(),
  body text not null check (length(body) between 1 and 12000)
);

create index if not exists ledger_room on public.ledger (room, id);

alter table public.ledger enable row level security;
revoke all on table public.ledger from public, anon, authenticated;

create or replace function public.ledger_read(p_room text, p_after bigint default 0)
returns table (id bigint, body text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.body from public.ledger l
  where l.room = p_room and l.id > p_after
  order by l.id
  limit 5000
$$;

create or replace function public.ledger_write(p_room text, p_body text)
returns bigint
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.ledger (room, body) values (p_room, p_body) returning id
$$;

revoke all on function public.ledger_read(text, bigint) from public;
revoke all on function public.ledger_write(text, text) from public;
grant execute on function public.ledger_read(text, bigint) to anon, authenticated;
grant execute on function public.ledger_write(text, text) to anon, authenticated;
