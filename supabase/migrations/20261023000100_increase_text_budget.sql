begin;

create or replace function public.reserve_paid_budget(p_owner_id uuid, p_resource text, p_units integer)
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
  where owner_id = p_owner_id and resource = p_resource and admitted_at > v_now - interval '1 minute';

  if (p_resource = 'speech' and v_recent >= 60)
    or (p_resource = 'text' and v_recent >= 10) then
    return jsonb_build_object('allowed', false, 'reason', 'rate', 'retry_after_seconds', 60);
  end if;
  if v_active >= 2 then
    return jsonb_build_object('allowed', false, 'reason', 'concurrent', 'retry_after_seconds', 2);
  end if;
  if (p_resource = 'text' and v_usage.reserved_text_tokens + p_units > 1000000)
    or (p_resource = 'speech' and v_usage.reserved_speech_chars + p_units > 30000) then
    return jsonb_build_object('allowed', false, 'reason', 'daily');
  end if;

  update public.paid_budget_days set
    reserved_text_tokens = reserved_text_tokens + case when p_resource = 'text' then p_units else 0 end,
    reserved_speech_chars = reserved_speech_chars + case when p_resource = 'speech' then p_units else 0 end
  where owner_id = p_owner_id and usage_day = v_day;

  insert into public.paid_budget_requests (owner_id, resource, admitted_at)
  values (p_owner_id, p_resource, v_now);

  insert into public.paid_budget_leases (owner_id, usage_day, resource, reserved_units, expires_at)
  values (p_owner_id, v_day, p_resource, p_units, v_now + interval '5 minutes')
  returning lease_id into v_lease_id;

  return jsonb_build_object('allowed', true, 'lease_id', v_lease_id);
end;
$$;

commit;