-- ============================================================
-- SAFE ROUTE - PHASE 1
-- Temporary ID communication system
-- ============================================================


-- ============================================================
-- 1. ENABLE UUID GENERATION
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 2. SAFE USERS
-- ============================================================

create table if not exists public.safe_users (

  id uuid primary key,

  safe_id text not null unique,

  last_seen timestamptz
    not null
    default now(),

  created_at timestamptz
    not null
    default now()

);


-- ============================================================
-- 3. MESSAGES
-- ============================================================

create table if not exists public.safe_messages (

  id uuid primary key
    default gen_random_uuid(),

  sender_id uuid
    not null,

  receiver_id uuid
    not null,

  message_type text
    not null
    default 'text',

  content text,

  latitude double precision,

  longitude double precision,

  media_path text,

  created_at timestamptz
    not null
    default now()

);


-- ============================================================
-- 4. VOICE CALL SIGNALS
-- ============================================================

create table if not exists public.safe_call_signals (

  id uuid primary key
    default gen_random_uuid(),

  sender_id uuid
    not null,

  receiver_id uuid
    not null,

  signal jsonb
    not null,

  created_at timestamptz
    not null
    default now()

);


-- ============================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.safe_users
enable row level security;

alter table public.safe_messages
enable row level security;

alter table public.safe_call_signals
enable row level security;


-- ============================================================
-- 6. SAFE USERS POLICIES
-- ============================================================

drop policy if exists
"Anyone can create temporary Safe Route ID"
on public.safe_users;

create policy
"Anyone can create temporary Safe Route ID"

on public.safe_users

for insert

to anon, authenticated

with check (
  true
);


drop policy if exists
"Anyone can find temporary Safe Route ID"
on public.safe_users;

create policy
"Anyone can find temporary Safe Route ID"

on public.safe_users

for select

to anon, authenticated

using (
  true
);


drop policy if exists
"Anyone can update temporary Safe Route ID"
on public.safe_users;

create policy
"Anyone can update temporary Safe Route ID"

on public.safe_users

for update

to anon, authenticated

using (
  true
)

with check (
  true
);


-- ============================================================
-- 7. MESSAGE POLICIES
-- ============================================================

drop policy if exists
"Users can send messages"
on public.safe_messages;

create policy
"Users can send messages"

on public.safe_messages

for insert

to anon, authenticated

with check (
  true
);


drop policy if exists
"Users can read messages"
on public.safe_messages;

create policy
"Users can read messages"

on public.safe_messages

for select

to anon, authenticated

using (
  true
);


-- ============================================================
-- 8. CALL SIGNAL POLICIES
-- ============================================================

drop policy if exists
"Users can send call signals"
on public.safe_call_signals;

create policy
"Users can send call signals"

on public.safe_call_signals

for insert

to anon, authenticated

with check (
  true
);


drop policy if exists
"Users can read call signals"
on public.safe_call_signals;

create policy
"Users can read call signals"

on public.safe_call_signals

for select

to anon, authenticated

using (
  true
);


-- ============================================================
-- 9. REALTIME
-- ============================================================

do $$

begin

  begin

    alter publication supabase_realtime
    add table public.safe_messages;

  exception
    when duplicate_object then
      null;

  end;


  begin

    alter publication supabase_realtime
    add table public.safe_call_signals;

  exception
    when duplicate_object then
      null;

  end;

end $$;


-- ============================================================
-- 10. VOICE MESSAGE STORAGE BUCKET
-- ============================================================

insert into storage.buckets
(
  id,
  name,
  public
)

values
(
  'voice-messages',
  'voice-messages',
  false
)

on conflict (id)
do nothing;


-- ============================================================
-- 11. STORAGE POLICIES
-- ============================================================

drop policy if exists
"Allow voice upload"
on storage.objects;

create policy
"Allow voice upload"

on storage.objects

for insert

to anon, authenticated

with check (
  bucket_id =
  'voice-messages'
);


drop policy if exists
"Allow voice read"
on storage.objects;

create policy
"Allow voice read"

on storage.objects

for select

to anon, authenticated

using (
  bucket_id =
  'voice-messages'
);


-- ============================================================
-- DONE
-- ============================================================
