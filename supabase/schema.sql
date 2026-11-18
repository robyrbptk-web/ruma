-- =============================================================================
-- RUMA — skema Supabase
-- Jalankan seluruh file ini sekali di Supabase → SQL Editor.
-- Aman dijalankan ulang: semua objek memakai IF NOT EXISTS / ON CONFLICT.
--
-- Semua tabel memakai RLS tanpa policy. Hanya service role key (dipakai oleh
-- fungsi /api/ruma di Vercel) yang dapat membaca/menulis. Kunci service role
-- tidak boleh pernah dikirim ke browser.
-- =============================================================================

create table if not exists public.users (
  id            text primary key,
  username      text not null,
  password_hash text not null,
  name          text not null,
  bio           text not null default '',
  color         text not null default '#e8efff',
  ink           text not null default '#2859a8',
  coins         integer not null default 1250,
  role          text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  status        text not null default 'active' check (status in ('active', 'blocked')),
  avatar_url    text not null default '',
  banner_url    text not null default '',
  verified      boolean not null default false,
  created_at    bigint not null
);
create unique index if not exists users_username_lower_idx on public.users (lower(username));

create table if not exists public.sessions (
  token      text primary key,
  user_id    text not null references public.users(id) on delete cascade,
  created_at bigint not null
);
create index if not exists sessions_user_idx on public.sessions (user_id);

create table if not exists public.posts (
  id         text primary key,
  user_id    text not null references public.users(id) on delete cascade,
  topic      text not null default 'Diskusi Umum',
  text       text not null,
  media_url  text not null default '',
  media_type text not null default '',
  media_name text not null default '',
  created_at bigint not null
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id);

create table if not exists public.comments (
  id         text primary key,
  post_id    text not null references public.posts(id) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  text       text not null,
  created_at bigint not null
);
create index if not exists comments_post_idx on public.comments (post_id);

create table if not exists public.likes (
  post_id text not null references public.posts(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.saves (
  post_id text not null references public.posts(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.reposts (
  post_id text not null references public.posts(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.follows (
  follower_id text not null references public.users(id) on delete cascade,
  target_id   text not null references public.users(id) on delete cascade,
  primary key (follower_id, target_id),
  check (follower_id <> target_id)
);

create table if not exists public.rooms (
  id            text primary key,
  name          text not null,
  description   text not null default '',
  category      text not null default 'Umum',
  emoji         text not null default '💬',
  access        text not null default 'public' check (access in ('public', 'private')),
  password_hash text not null default '',
  owner_id      text not null references public.users(id) on delete cascade,
  verified      boolean not null default false,
  created_at    bigint not null
);

create table if not exists public.room_members (
  room_id text not null references public.rooms(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (room_id, user_id)
);

create table if not exists public.room_posts (
  id         text primary key,
  room_id    text not null references public.rooms(id) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  text       text not null,
  likes      integer not null default 0,
  created_at bigint not null
);
create index if not exists room_posts_room_idx on public.room_posts (room_id, created_at desc);

create table if not exists public.reels (
  id         text primary key,
  user_id    text not null references public.users(id) on delete cascade,
  emoji      text not null default '🎬',
  caption    text not null default '',
  audio      text not null default '',
  media_url  text not null default '',
  media_type text not null default '',
  created_at bigint not null
);
create index if not exists reels_created_idx on public.reels (created_at desc);

create table if not exists public.reel_likes (
  reel_id text not null references public.reels(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (reel_id, user_id)
);

create table if not exists public.reel_saves (
  reel_id text not null references public.reels(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  primary key (reel_id, user_id)
);

create table if not exists public.gifts (
  id         text primary key,
  reel_id    text not null references public.reels(id) on delete cascade,
  sender_id  text not null references public.users(id) on delete cascade,
  gift_name  text not null,
  coins      integer not null default 0,
  created_at bigint not null
);

create table if not exists public.reports (
  id            text primary key,
  post_id       text not null references public.posts(id) on delete cascade,
  reporter_id   text not null references public.users(id) on delete cascade,
  reason        text not null default 'Pelanggaran panduan',
  status        text not null default 'open',
  created_at    bigint not null,
  resolved_at   bigint
);
create index if not exists reports_status_idx on public.reports (status);

create table if not exists public.notifications (
  id         text primary key,
  user_id    text not null references public.users(id) on delete cascade,
  type       text not null default 'activity',
  actor_id   text references public.users(id) on delete set null,
  entity_id  text not null default '',
  message    text not null default '',
  is_read    boolean not null default false,
  created_at bigint not null
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: aktifkan di semua tabel aplikasi, tanpa policy.
-- Service role tetap bisa melakukan apa pun; anon/authenticated tidak bisa.
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'users', 'sessions', 'posts', 'comments', 'likes', 'saves', 'reposts',
    'follows', 'rooms', 'room_members', 'room_posts', 'reels', 'reel_likes',
    'reel_saves', 'gifts', 'reports', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: bucket publik untuk media (foto/video). Unggahan dilakukan lewat
-- signed upload URL, jadi browser tidak pernah memegang service role key.
-- Batas 50 MB mengikuti batas unggahan paket Supabase gratis.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('ruma-media', 'ruma-media', true, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'ruma_media_public_read'
  ) then
    execute 'create policy ruma_media_public_read on storage.objects for select using (bucket_id = ''ruma-media'')';
  end if;
end $$;

-- Selesai. Lanjutkan dengan membuat admin:
--   npm run create-admin -- --username roby --password "kata-sandi-kuat"
-- atau impor data Google Sheets:
--   npm run import-sheets -- ./sheet-data
