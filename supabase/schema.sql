create table if not exists public.vocabulary_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null check (char_length(term) between 1 and 200),
  normalized_term text not null,
  meaning text not null default '',
  note text not null default '',
  mastery smallint not null default 0 check (mastery between 0 and 5),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create index if not exists vocabulary_entries_user_updated_idx
  on public.vocabulary_entries (user_id, updated_at desc);

alter table public.vocabulary_entries enable row level security;

drop policy if exists "Users can read their own words" on public.vocabulary_entries;
create policy "Users can read their own words"
  on public.vocabulary_entries for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own words" on public.vocabulary_entries;
create policy "Users can create their own words"
  on public.vocabulary_entries for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own words" on public.vocabulary_entries;
create policy "Users can update their own words"
  on public.vocabulary_entries for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own words" on public.vocabulary_entries;
create policy "Users can delete their own words"
  on public.vocabulary_entries for delete
  using ((select auth.uid()) = user_id);