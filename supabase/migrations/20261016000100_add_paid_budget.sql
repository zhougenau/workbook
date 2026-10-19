create table public.paid_budget_days (
  owner_id uuid not null,
  usage_day date not null,
  reserved_text_tokens bigint not null default 0,
  actual_text_tokens bigint not null default 0,
  reserved_speech_chars bigint not null default 0,
  actual_speech_chars bigint not null default 0,
  primary key (owner_id, usage_day)
);

create table public.paid_budget_requests (
  request_id bigint generated always as identity primary key,
  owner_id uuid not null,
  admitted_at timestamptz not null
);

create index paid_budget_requests_owner_time_idx
  on public.paid_budget_requests (owner_id, admitted_at);

create table public.paid_budget_leases (
  lease_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  usage_day date not null,
  resource text not null check (resource in ('text', 'speech')),
  reserved_units integer not null check (reserved_units > 0),
  expires_at timestamptz not null,
  foreign key (owner_id, usage_day) references public.paid_budget_days (owner_id, usage_day) on delete cascade
);

create index paid_budget_leases_owner_expiry_idx
  on public.paid_budget_leases (owner_id, expires_at);

alter table public.paid_budget_days enable row level security;
alter table public.paid_budget_requests enable row level security;
alter table public.paid_budget_leases enable row level security;
revoke all on public.paid_budget_days, public.paid_budget_requests, public.paid_budget_leases from anon, authenticated;

create function public.reserve_paid_budget(p_owner_id uuid, p_resource text, p_units integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'utc')::date;
  v_usage public.paid_budget_days%rowtype;
  v_active integer;
  v_recent integer;
  v_lease_id uuid;
begin
  if p_owner_id is null or p_resource not in ('text', 'speech') or p_units is null or p_units < 1 then
    raise exception 'Invalid budget request';
  end if;

  insert into public.paid_budget_days (owner_id, usage_day)
  values (p_owner_id, v_day)
  on conflict do nothing;

  select * into v_usage from public.paid_budget_days
  where owner_id = p_owner_id and usage_day = v_day for update;

  delete from public.paid_budget_leases
  where owner_id = p_owner_id and expires_at <= v_now;
  delete from public.paid_budget_requests
  where owner_id = p_owner_id and admitted_at <= v_now - interval '1 minute';

  select count(*) into v_active from public.paid_budget_leases
  where owner_id = p_owner_id and expires_at > v_now;
  select count(*) into v_recent from public.paid_budget_requests
  where owner_id = p_owner_id and admitted_at > v_now - interval '1 minute';

  if v_recent >= 10 or v_active >= 2
    or (p_resource = 'text' and v_usage.reserved_text_tokens + p_units > 100000)
    or (p_resource = 'speech' and v_usage.reserved_speech_chars + p_units > 10000) then
    return jsonb_build_object('allowed', false);
  end if;

  update public.paid_budget_days set
    reserved_text_tokens = reserved_text_tokens + case when p_resource = 'text' then p_units else 0 end,
    reserved_speech_chars = reserved_speech_chars + case when p_resource = 'speech' then p_units else 0 end
  where owner_id = p_owner_id and usage_day = v_day;

  insert into public.paid_budget_requests (owner_id, admitted_at)
  values (p_owner_id, v_now);

  insert into public.paid_budget_leases (owner_id, usage_day, resource, reserved_units, expires_at)
  values (p_owner_id, v_day, p_resource, p_units, v_now + interval '5 minutes')
  returning lease_id into v_lease_id;

  return jsonb_build_object('allowed', true, 'lease_id', v_lease_id);
end;
$$;

create function public.finish_paid_budget(p_lease_id uuid, p_actual_units integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_day date;
  v_resource text;
begin
  delete from public.paid_budget_leases where lease_id = p_lease_id
  returning owner_id, usage_day, resource into v_owner_id, v_day, v_resource;
  if not found then return; end if;

  update public.paid_budget_days set
    actual_text_tokens = actual_text_tokens + case when v_resource = 'text' then greatest(coalesce(p_actual_units, 0), 0) else 0 end,
    actual_speech_chars = actual_speech_chars + case when v_resource = 'speech' then greatest(coalesce(p_actual_units, 0), 0) else 0 end
  where owner_id = v_owner_id and usage_day = v_day;
end;
$$;

revoke all on function public.reserve_paid_budget(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finish_paid_budget(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_paid_budget(uuid, text, integer) to service_role;
grant execute on function public.finish_paid_budget(uuid, integer) to service_role;