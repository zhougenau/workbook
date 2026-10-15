create table if not exists public.wechat_identities (
  user_id uuid primary key default gen_random_uuid(),
  appid text not null,
  openid text not null,
  unionid text,
  linked_auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  unique (appid, openid)
);

create index if not exists wechat_identities_unionid_idx
  on public.wechat_identities (unionid)
  where unionid is not null;

create table if not exists public.mini_sessions (
  token_hash text primary key,
  user_id uuid not null references public.wechat_identities(user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists mini_sessions_user_idx
  on public.mini_sessions (user_id, expires_at desc);

create index if not exists mini_sessions_expiry_idx
  on public.mini_sessions (expires_at);

alter table public.wechat_identities enable row level security;
alter table public.mini_sessions enable row level security;

revoke all on table public.wechat_identities from anon, authenticated;
revoke all on table public.mini_sessions from anon, authenticated;
