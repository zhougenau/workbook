begin;
create table public.passport_devices (
  owner_id uuid primary key references auth.users on delete cascade,
  device_hash text not null unique check (device_hash ~ '^[0-9a-f]{64}$'),
  pin text check (pin ~ '^[0-9]{4}$'),
  expires_at timestamptz,
  attempts integer not null default 0,
  payload text check (length(payload) between 8 and 21848)
);
alter table public.passport_devices enable row level security;
revoke all on public.passport_devices from public, anon, authenticated;
grant select, insert, update on public.passport_devices to service_role;

create function public.passport_publish_pin(account uuid, digits text, pack text)
returns boolean language plpgsql set search_path = '' as $$
declare accepted boolean;
begin
  update public.passport_devices set attempts = attempts + 1,
    payload = case when pin = digits then pack else null end
    where owner_id = account and expires_at > now() and attempts < 5 and payload is null and pin is not null
    returning pin = digits into accepted;
  return coalesce(accepted, false);
end;
$$;

create function public.passport_take_bound(device text) returns text language plpgsql set search_path = '' as $$
declare result text;
begin
  select payload into result from public.passport_devices where device_hash = device and expires_at > now() for update;
  if result is not null then
    update public.passport_devices set pin = null, payload = null, expires_at = null where device_hash = device;
  end if;
  return result;
end;
$$;
revoke all on function public.passport_publish_pin(uuid,text,text), public.passport_take_bound(text) from public, anon, authenticated;
grant execute on function public.passport_publish_pin(uuid,text,text), public.passport_take_bound(text) to service_role;
commit;