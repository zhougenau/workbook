alter table public.wechat_identities
  add column if not exists owner_id uuid;

update public.wechat_identities
set owner_id = coalesce(linked_auth_user_id, user_id)
where owner_id is null;

alter table public.wechat_identities
  alter column owner_id set not null;

create or replace function public.assign_wechat_identity_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is null then
    new.owner_id := coalesce(new.linked_auth_user_id, new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists assign_wechat_identity_owner_trigger
  on public.wechat_identities;

create trigger assign_wechat_identity_owner_trigger
before insert on public.wechat_identities
for each row execute function public.assign_wechat_identity_owner();

create index if not exists wechat_identities_owner_idx
  on public.wechat_identities (owner_id);

alter table public.vocabulary_entries
  drop constraint if exists vocabulary_entries_user_id_fkey;

comment on column public.vocabulary_entries.user_id is
  'Logical owner UUID. For Web users this equals auth.users.id; for WeChat-only users it equals wechat_identities.owner_id.';
