begin;

create table public.review_schedules (
  word_id uuid primary key references public.vocabulary_entries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  due_at timestamptz not null,
  interval_days integer not null check (interval_days between 0 and 30),
  streak integer not null check (streak between 0 and 5),
  last_reviewed_at timestamptz not null,
  updated_at timestamptz not null
);

create index review_schedules_owner_due_idx on public.review_schedules (owner_id, due_at);

alter table public.review_schedules enable row level security;
create policy review_schedules_owner on public.review_schedules
  for all to authenticated
  using (owner_id = auth.uid() and exists (
    select 1 from public.vocabulary_entries where id = word_id and user_id = auth.uid()
  ))
  with check (owner_id = auth.uid() and exists (
    select 1 from public.vocabulary_entries where id = word_id and user_id = auth.uid()
  ));

create function public.merge_review_schedules(p_owner_id uuid, p_schedules jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule jsonb;
begin
  if jsonb_typeof(p_schedules) <> 'array' or jsonb_array_length(p_schedules) > 500 then
    raise exception 'Invalid review schedule batch';
  end if;
  for v_schedule in select value from jsonb_array_elements(p_schedules) loop
    if not exists (
      select 1 from public.vocabulary_entries
      where id = (v_schedule->>'wordId')::uuid and user_id = p_owner_id and deleted_at is null
    ) then
      raise exception 'Review word does not belong to owner';
    end if;
    insert into public.review_schedules (word_id, owner_id, due_at, interval_days, streak, last_reviewed_at, updated_at)
    values (
      (v_schedule->>'wordId')::uuid, p_owner_id, (v_schedule->>'dueAt')::timestamptz,
      (v_schedule->>'intervalDays')::integer, (v_schedule->>'streak')::integer,
      (v_schedule->>'lastReviewedAt')::timestamptz, (v_schedule->>'updatedAt')::timestamptz
    )
    on conflict (word_id) do update set
      due_at = excluded.due_at,
      interval_days = excluded.interval_days,
      streak = excluded.streak,
      last_reviewed_at = excluded.last_reviewed_at,
      updated_at = excluded.updated_at
    where public.review_schedules.owner_id = p_owner_id
      and public.review_schedules.updated_at < excluded.updated_at;
  end loop;
end;
$$;

revoke all on function public.merge_review_schedules(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_review_schedules(uuid, jsonb) to service_role;

commit;