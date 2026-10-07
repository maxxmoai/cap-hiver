create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists user_data (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists strava_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  athlete_id bigint not null unique,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at bigint not null
);

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
