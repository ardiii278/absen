-- Migration schema according to PRD SQL schemas and policies

-- Enums
create type app_role as enum ('super_admin','admin','kiosk');
create type approval_status as enum ('pending_approval','approved','rejected');

-- Projects table
create table projects(
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  lat numeric,
  lng numeric,
  radius_m int,
  created_at timestamptz default now()
);

-- Profiles table (extends auth.users)
create table profiles(
  id uuid primary key references auth.users on delete cascade,
  role app_role not null,
  full_name text,
  created_at timestamptz default now()
);

-- Admin Projects mapping table
create table admin_projects(
  user_id uuid references profiles on delete cascade,
  project_id uuid references projects on delete cascade,
  primary key(user_id,project_id)
);

-- Kiosk Accounts mapped to internal auth users
create table kiosk_accounts(
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users on delete cascade,
  username text unique not null,
  project_id uuid not null references projects on delete cascade,
  is_active boolean default true,
  last_seen_at timestamptz
);

-- Workers table
create table workers(
  id uuid primary key default gen_random_uuid(),
  nik varchar(16) unique not null check(nik ~ '^[0-9]{16}$'),
  name text not null,
  position text check(position in ('TK','KN')),
  job_scope text not null,
  project_id uuid not null references projects on delete cascade,
  status approval_status default 'pending_approval',
  is_active boolean default false,
  profile_path text not null,
  ktp_private_path text,
  face_descriptor jsonb,
  daily_wage numeric(14,2) default 0,
  created_at timestamptz default now()
);

-- Attendance table
create table attendance(
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid unique not null,
  worker_id uuid references workers on delete cascade,
  project_id uuid references projects on delete cascade,
  type text check(type in ('in','out')),
  occurred_at timestamptz not null,
  evidence_path text,
  gps jsonb,
  source text, -- 'face' or 'manual'
  status approval_status default 'approved',
  conflict_of uuid references attendance on delete set null,
  late_deduction numeric(14,2) default 0,
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);

-- Overtime table
create table overtime(
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  work_date date not null,
  hours numeric(6,2),
  evidence_path text,
  status approval_status default 'pending_approval',
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);

-- Overtime Workers mapping
create table overtime_workers(
  overtime_id uuid references overtime on delete cascade,
  worker_id uuid references workers on delete cascade,
  hours numeric(6,2) not null,
  primary key(overtime_id,worker_id)
);

-- Audit Logs table
create table audit_logs(
  id bigint generated always as identity primary key,
  actor_id uuid references profiles on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  reason text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

-- RLS helper function
create or replace function can_access_project(p_project_id uuid)
returns boolean security definer language plpgsql as $$
declare
  v_user_id uuid;
  v_role app_role;
  v_kiosk_project uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- Get user profile role
  select role into v_role from profiles where id = v_user_id;

  if v_role = 'super_admin' then
    return true;
  end if;

  if v_role = 'admin' then
    return exists (
      select 1 from admin_projects 
      where user_id = v_user_id and project_id = p_project_id
    );
  end if;

  if v_role = 'kiosk' then
    select project_id into v_kiosk_project from kiosk_accounts where auth_user_id = v_user_id;
    return v_kiosk_project = p_project_id;
  end if;

  return false;
end;
$$;

-- Role checking helper functions to prevent RLS infinite recursion
create or replace function is_super_admin(p_user_id uuid)
returns boolean security definer language plpgsql as $$
begin
  return exists (
    select 1 from profiles where id = p_user_id and role = 'super_admin'
  );
end;
$$;

create or replace function is_admin_or_super_admin(p_user_id uuid)
returns boolean security definer language plpgsql as $$
begin
  return exists (
    select 1 from profiles where id = p_user_id and role in ('admin', 'super_admin')
  );
end;
$$;

create or replace function is_kiosk(p_user_id uuid)
returns boolean security definer language plpgsql as $$
begin
  return exists (
    select 1 from profiles where id = p_user_id and role = 'kiosk'
  );
end;
$$;

-- Enable Row Level Security (RLS) on all tables
alter table projects enable row level security;
alter table profiles enable row level security;
alter table admin_projects enable row level security;
alter table kiosk_accounts enable row level security;
alter table workers enable row level security;
alter table attendance enable row level security;
alter table overtime enable row level security;
alter table overtime_workers enable row level security;
alter table audit_logs enable row level security;

-- Policies for projects
create policy "Users can view projects they can access" on projects
  for select using (can_access_project(id));

create policy "Super admins can manage projects" on projects
  for all using (is_super_admin(auth.uid()));

-- Policies for profiles
create policy "Users can view their own profile or super admin read all" on profiles
  for select using (id = auth.uid() or is_super_admin(auth.uid()));

create policy "Super admins can manage profiles" on profiles
  for all using (is_super_admin(auth.uid()));

-- Policies for admin_projects
create policy "Admins can view their project bindings" on admin_projects
  for select using (user_id = auth.uid() or is_super_admin(auth.uid()));

-- Policies for kiosk_accounts
create policy "Admins can manage kiosk accounts" on kiosk_accounts
  for all using (
    auth_user_id = auth.uid() or 
    is_admin_or_super_admin(auth.uid())
  ) with check (
    auth_user_id = auth.uid() or 
    is_admin_or_super_admin(auth.uid())
  );

-- Policies for workers
create policy "Read active/pending workers on allowed projects" on workers
  for select using (can_access_project(project_id));

create policy "Insert workers for kiosk/admins" on workers
  for insert with check (can_access_project(project_id));

create policy "Update/Delete workers restricted to allowed project admin/super_admin" on workers
  for all using (
    can_access_project(project_id) and 
    is_admin_or_super_admin(auth.uid())
  );

-- Policies for attendance
create policy "Read attendance on allowed projects" on attendance
  for select using (can_access_project(project_id));

create policy "Insert attendance from kiosk/admins" on attendance
  for insert with check (
    can_access_project(project_id) and
    (
      is_kiosk(auth.uid()) or
      is_admin_or_super_admin(auth.uid())
    )
  );

create policy "Update attendance restricted to admin/super_admin" on attendance
  for update using (
    can_access_project(project_id) and 
    is_admin_or_super_admin(auth.uid())
  );

-- Policies for overtime
create policy "Read overtime on allowed projects" on overtime
  for select using (can_access_project(project_id));

create policy "Manage overtime restricted to admin/super_admin" on overtime
  for all using (
    can_access_project(project_id) and
    is_admin_or_super_admin(auth.uid())
  );

-- Policies for overtime_workers
create policy "Read overtime_workers" on overtime_workers
  for select using (
    exists (
      select 1 from overtime 
      where overtime.id = overtime_workers.overtime_id and can_access_project(overtime.project_id)
    )
  );

create policy "Manage overtime_workers restricted to admin/super_admin" on overtime_workers
  for all using (
    exists (
      select 1 from overtime 
      where overtime.id = overtime_workers.overtime_id and can_access_project(overtime.project_id)
    ) and is_admin_or_super_admin(auth.uid())
  );

-- Policies for audit_logs
create policy "Read audit logs for admin/super_admin" on audit_logs
  for select using (is_admin_or_super_admin(auth.uid()));

create policy "Authenticated users can insert audit logs" on audit_logs
  for insert with check (auth.uid() is not null);

-- Login attempts table for shared database rate limiting
create table login_attempts(
  ip_address text primary key,
  attempts int not null default 1,
  last_attempt timestamptz not null default now()
);

alter table login_attempts enable row level security;

create policy "Allow public access to login attempts" on login_attempts
  for all using (true) with check (true);

-- Notice: Append-only audit logs. No update/delete policies, which makes it read-only/append-only for clients.

-- Kiosk login history table for tracking kiosk login sessions
create table kiosk_login_history(
  id uuid primary key default gen_random_uuid(),
  kiosk_account_id uuid not null references kiosk_accounts(id) on delete cascade,
  username text not null,
  project_id uuid not null references projects(id) on delete cascade,
  ip_address text,
  status text not null check(status in ('success','failed')),
  created_at timestamptz default now()
);

alter table kiosk_login_history enable row level security;

create policy "Admin/super_admin can read kiosk login history" on kiosk_login_history
  for select using (
    is_admin_or_super_admin(auth.uid())
  );

create policy "Public can insert kiosk login history" on kiosk_login_history
  for insert with check (true);

-- Indexes for efficient queries
create index idx_kiosk_login_history_kiosk_account_id on kiosk_login_history(kiosk_account_id);
create index idx_kiosk_login_history_created_at on kiosk_login_history(created_at desc);
create index idx_kiosk_login_history_project_id on kiosk_login_history(project_id);
create index idx_attendance_worker_id on attendance(worker_id);
create index idx_attendance_project_id_occurred_at on attendance(project_id, occurred_at);
create index idx_overtime_project_id on overtime(project_id);
create index idx_workers_project_id on workers(project_id);
create index idx_workers_nik on workers(nik);

-- Error logs table for centralized system error tracking
create table error_logs(
  id uuid primary key default gen_random_uuid(),
  pathname text not null,
  method text not null,
  error_message text not null,
  stack_trace text,
  user_id uuid,
  created_at timestamptz default now()
);

alter table error_logs enable row level security;

create policy "Admin/super_admin can view error logs" on error_logs
  for select using (is_admin_or_super_admin(auth.uid()));

create policy "Allow insert error logs to authenticated/public" on error_logs
  for insert with check (true);

create index idx_error_logs_created_at on error_logs(created_at desc);

-- Private Storage Policies for kiosk-photos bucket
-- Ensure RLS is enabled on storage.objects if not already
alter table storage.objects enable row level security;

create policy "Allow insert access to kiosk-photos" on storage.objects
  for insert with check (bucket_id = 'kiosk-photos');

create policy "Allow select access to kiosk-photos" on storage.objects
  for select using (
    bucket_id = 'kiosk-photos' and (
      -- Super admin can read everything
      is_super_admin(auth.uid())
      or
      -- Admin and kiosk can read temp/ and evidence/
      (
        not (name like 'private/%') and
        (
          is_admin_or_super_admin(auth.uid()) or
          is_kiosk(auth.uid())
        )
      )
    )
  );

create policy "Allow delete access to kiosk-photos" on storage.objects
  for delete using (
    bucket_id = 'kiosk-photos' and
    is_admin_or_super_admin(auth.uid())
  );
