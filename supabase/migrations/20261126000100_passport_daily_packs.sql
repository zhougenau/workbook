create table public.passport_daily_packs (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  payload text not null check (length(payload) between 8 and 21848 and payload ~ '^[A-Za-z0-9+/]+=*$'),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
alter table public.passport_daily_packs enable row level security;
revoke all on public.passport_daily_packs from public, anon, authenticated;
grant select, insert(owner_id, code_hash, payload), update(owner_id, code_hash, payload) on public.passport_daily_packs to authenticated;
create policy passport_owner on public.passport_daily_packs for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create function public.passport_refresh_expiry() returns trigger language plpgsql set search_path = '' as $$
begin new.expires_at := now() + interval '10 minutes'; return new; end
$$;
create trigger passport_expiry before insert or update on public.passport_daily_packs
for each row execute function public.passport_refresh_expiry();

create function public.passport_claim(digest text) returns text language sql set search_path = '' as $$
  delete from public.passport_daily_packs where code_hash = digest and expires_at > now() returning payload;
$$;
revoke all on function public.passport_claim(text) from public, anon, authenticated;
grant execute on function public.passport_claim(text) to service_role;
grant select, delete on public.passport_daily_packs to service_role;