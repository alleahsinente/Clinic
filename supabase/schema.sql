create type public.app_role as enum ('student', 'admin');
create type public.appointment_status as enum ('pending', 'confirmed', 'cancelled', 'completed');

create table public.student_roster (
  student_code text primary key
    check (student_code ~ '^CCD-[0-9]{4}-[0-9]{5}$'),
  email text not null,
  full_name text,
  course text,
  section text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index student_roster_email_lower_key
  on public.student_roster (lower(email));

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  student_code text not null unique
    check (student_code ~ '^CCD-[0-9]{4}-[0-9]{5}$'),
  email text not null unique,
  full_name text not null,
  course text,
  section text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  service text not null check (service in (
    'General consultation',
    'Pediatrics & immunization',
    'Maternal & family health',
    'Laboratory & imaging',
    'Dental care'
  )),
  appointment_date date not null,
  time_slot text not null check (time_slot in ('morning', 'afternoon')),
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extract(dow from appointment_date) <> 0),
  check (not (extract(dow from appointment_date) = 6 and time_slot = 'afternoon'))
);

create index appointments_student_date_idx
  on public.appointments (student_id, appointment_date desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster_entry public.student_roster%rowtype;
  requested_code text;
begin
  requested_code := upper(coalesce(new.raw_user_meta_data ->> 'student_code', ''));

  select *
    into roster_entry
    from public.student_roster
   where student_code = requested_code
     and lower(email) = lower(new.email)
     and is_active;

  if not found then
    raise exception 'This student code and email are not on the approved roster.';
  end if;

  insert into public.profiles (
    id, student_code, email, full_name, course, section
  ) values (
    new.id,
    roster_entry.student_code,
    lower(new.email),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(roster_entry.full_name), ''),
      split_part(new.email, '@', 1)
    ),
    roster_entry.course,
    roster_entry.section
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'student');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.student_roster enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.appointments enable row level security;

create policy "Admins manage the approved student roster"
  on public.student_roster
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Students and admins read profiles"
  on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "Students and admins update allowed profile fields"
  on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create policy "Users read their role; admins read all roles"
  on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Students and admins read appointments"
  on public.appointments
  for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_admin()));

create policy "Students create their own appointment requests"
  on public.appointments
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy "Only admins update appointment status"
  on public.appointments
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant usage on schema public to authenticated;

revoke all on public.student_roster, public.profiles, public.user_roles, public.appointments
  from public, anon, authenticated;

grant select, insert, update, delete on public.student_roster to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, course, section, phone) on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.appointments to authenticated;
grant insert (student_id, service, appointment_date, time_slot)
  on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'appointments'
  ) then
    execute 'alter publication supabase_realtime add table public.appointments';
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.profiles';
  end if;
end;
$$;
