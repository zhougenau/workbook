create table if not exists public.account_link_codes (
  code_hash text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists account_link_codes_user_idx
  on public.account_link_codes (auth_user_id, expires_at desc);

alter table public.account_link_codes enable row level security;
revoke all on table public.account_link_codes from anon, authenticated;

create or replace function public.link_wechat_owner(
  p_identity_user_id uuid,
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity public.wechat_identities%rowtype;
  v_code public.account_link_codes%rowtype;
  v_source public.vocabulary_entries%rowtype;
  v_target public.vocabulary_entries%rowtype;
  v_merge_time timestamptz := now();
  v_moved integer := 0;
  v_merged integer := 0;
begin
  select * into v_identity
  from public.wechat_identities
  where user_id = p_identity_user_id
  for update;

  if not found then
    raise exception 'WECHAT_IDENTITY_NOT_FOUND';
  end if;

  select * into v_code
  from public.account_link_codes
  where code_hash = p_code_hash
  for update;

  if not found or v_code.consumed_at is not null or v_code.expires_at <= v_merge_time then
    raise exception 'LINK_CODE_INVALID';
  end if;

  if v_identity.owner_id <> v_code.auth_user_id then
    for v_source in
      select *
      from public.vocabulary_entries
      where user_id = v_identity.owner_id
      order by updated_at asc
      for update
    loop
      select * into v_target
      from public.vocabulary_entries
      where user_id = v_code.auth_user_id
        and normalized_term = v_source.normalized_term
        and id <> v_source.id
      order by updated_at desc
      limit 1
      for update;

      if found then
        if v_source.updated_at > v_target.updated_at then
          update public.vocabulary_entries
          set term = v_source.term,
              normalized_term = v_source.normalized_term,
              meaning = v_source.meaning,
              note = v_source.note,
              mastery = v_source.mastery,
              created_at = least(v_target.created_at, v_source.created_at),
              updated_at = v_source.updated_at,
              deleted_at = v_source.deleted_at
          where id = v_target.id;
        end if;

        update public.vocabulary_entries
        set user_id = v_code.auth_user_id,
            updated_at = v_merge_time,
            deleted_at = v_merge_time
        where id = v_source.id;
        v_merged := v_merged + 1;
      else
        update public.vocabulary_entries
        set user_id = v_code.auth_user_id
        where id = v_source.id;
        v_moved := v_moved + 1;
      end if;
    end loop;
  end if;

  update public.wechat_identities
  set owner_id = v_code.auth_user_id,
      linked_auth_user_id = v_code.auth_user_id,
      last_login_at = v_merge_time
  where user_id = p_identity_user_id;

  update public.account_link_codes
  set consumed_at = v_merge_time
  where code_hash = p_code_hash;

  return jsonb_build_object(
    'ownerId', v_code.auth_user_id,
    'movedCount', v_moved,
    'mergedCount', v_merged
  );
end;
$$;

revoke all on function public.link_wechat_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.link_wechat_owner(uuid, text) to service_role;
