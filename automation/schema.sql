-- Saudi Science Jobs — Supabase schema (v2, production)
-- Run this once in the SQL editor of a NEW Supabase project.
-- Safe to re-run: every statement is guarded.

-- gen_random_uuid() is core since Postgres 13, so no extension is needed.

/* ─────────────────────────────────────────────── jobs ── */

create table if not exists public.jobs (
  -- Telegram rows use  ch-<channel>-<post_id>  so the source post is the key.
  -- Employer submissions get a random id.
  id               text primary key default ('emp-' || gen_random_uuid()),

  status           text not null default 'pending'
                   check (status in ('pending','published','expired','deleted')),
  source           text not null default 'telegram'
                   check (source in ('telegram','employer')),

  -- provenance
  source_channel   text,          -- e.g. cd4cd            (telegram only)
  post_id          bigint,        -- e.g. 36990            (telegram only)
  permalink        text,          -- original post URL (follows a forward header)
  relay_link       text,          -- the post as seen in the monitored channel
  posted_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- vacancy
  employer         text,
  title            text,
  specialty        text,
  city             text,
  district         text,
  employment_type  text,
  compensation     text,          -- only if explicitly stated
  gender_pref      text check (gender_pref in ('رجال','نساء') or gender_pref is null),
  saudi_only       boolean,
  needs_scfhs      boolean,
  notes            text,

  -- application
  contact_phone    text,
  contact_email    text,
  apply_url        text,

  -- pipeline metadata
  from_image       boolean not null default false,   -- OCR was used
  ai_confidence    numeric,
  raw_excerpt      text,                             -- for admin review / audit
  reviewed_by      text,
  reviewed_at      timestamptz
);

-- Older projects created this table as v1; bring them forward without data loss.
alter table public.jobs add column if not exists source_channel  text;
alter table public.jobs add column if not exists post_id         bigint;
alter table public.jobs add column if not exists updated_at      timestamptz not null default now();
alter table public.jobs add column if not exists ai_confidence   numeric;
alter table public.jobs add column if not exists raw_excerpt     text;
alter table public.jobs add column if not exists reviewed_by     text;
alter table public.jobs add column if not exists reviewed_at     timestamptz;

/* ──────────────────────────────────── duplicate prevention ── */
-- Four independent identities. A post is a duplicate if it collides on ANY of
-- them, which catches the same vacancy relayed between channels, reposted a
-- week later, or pasted by an employer who also posted it to Telegram.
-- 'deleted' rows are excluded so a removed listing can be re-added.

alter table public.jobs add column if not exists dedup_url         text;
alter table public.jobs add column if not exists dedup_contact     text;
alter table public.jobs add column if not exists dedup_fingerprint text;

create unique index if not exists jobs_dedup_url_key
  on public.jobs (dedup_url)         where dedup_url is not null         and status <> 'deleted';
create unique index if not exists jobs_dedup_contact_key
  on public.jobs (dedup_contact)     where dedup_contact is not null     and status <> 'deleted';
create unique index if not exists jobs_dedup_fingerprint_key
  on public.jobs (dedup_fingerprint) where dedup_fingerprint is not null and status <> 'deleted';

create index if not exists jobs_public_feed   on public.jobs (status, posted_at desc);
create index if not exists jobs_city_idx      on public.jobs (city);
create index if not exists jobs_specialty_idx on public.jobs (specialty);
create index if not exists jobs_channel_idx   on public.jobs (source_channel, post_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at before update on public.jobs
  for each row execute function public.touch_updated_at();

/* ─────────────────────────────────────────────── meta ── */
-- Per-channel cursors live here: key = channel_cursor_<channel>.

create table if not exists public.meta (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

/* ─────────────────────────────────────────────── admins ── */
-- Moderation allowlist. Adding a row here does NOT create the login; the
-- person must also exist in Supabase Auth with the same email.

create table if not exists public.admins (
  email      text primary key,
  added_at   timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

/* ─────────────────────────────────── row level security ── */

alter table public.jobs   enable row level security;
alter table public.meta   enable row level security;
alter table public.admins enable row level security;

-- Public: published jobs from the last 30 days, nothing else.
-- Expired, deleted and pending rows are invisible to anon and to signed-in
-- non-admins alike.
drop policy if exists "public reads published jobs" on public.jobs;
create policy "public reads published jobs" on public.jobs
  for select to anon, authenticated
  using (status = 'published' and posted_at >= now() - interval '30 days');

-- Admins: full moderation rights.
drop policy if exists "admins read all jobs" on public.jobs;
create policy "admins read all jobs" on public.jobs
  for select to authenticated using (public.is_admin());

drop policy if exists "admins insert jobs" on public.jobs;
create policy "admins insert jobs" on public.jobs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update jobs" on public.jobs;
create policy "admins update jobs" on public.jobs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No delete policy on purpose: moderation sets status = 'deleted' so a row is
-- always recoverable. Hard deletes stay a service-role/manual operation.

drop policy if exists "admins read allowlist" on public.admins;
create policy "admins read allowlist" on public.admins
  for select to authenticated using (public.is_admin());

-- meta has RLS on and no policy at all: only the service role (the GitHub
-- Action) can read or move the channel cursors.

/* ──────────────────────────────── grants ── */
-- RLS decides the rows; grants decide the verbs. anon may only read.

grant usage on schema public to anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant insert, update on public.jobs to authenticated;
grant select on public.admins to authenticated;
revoke all on public.meta from anon, authenticated;

-- Employer submissions are NOT inserted by the browser. The website posts them
-- to its own server route, which validates and writes with the service-role
-- key as status='pending'. That is why anon has no insert grant here.

/* ──────────────────────────────── seed your admin ── */
-- Replace with your own address, then create the same user in
-- Authentication → Users (or sign up once and confirm the email).
-- insert into public.admins (email) values ('you@example.com')
--   on conflict (email) do nothing;
