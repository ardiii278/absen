-- Migration: Add username column to profiles for username-based admin login
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/dryvpgaxtbwylombyoom/sql/new

-- 1. Add username column to profiles
ALTER TABLE profiles ADD COLUMN username text UNIQUE;

-- 2. Create unique index for fast lookup
CREATE INDEX idx_profiles_username ON profiles(username);

-- 3. ============================================
--    CARA SETUP AKUN
--    ============================================

-- CARA 1: Bikin akun admin via Supabase Dashboard
-- Step 1: Buka Authentication > Users > Add User
-- Step 2: Isi email: admin_<username>@internal-dashboard.local
--           (contoh: admin_ardi@internal-dashboard.local)
-- Step 3: Isi password (minimal 6 karakter)
-- Step 4: Copy user ID yang muncul
-- Step 5: Jalankan SQL ini dengan user ID yang di-copy:
-- 
-- INSERT INTO profiles (id, role, full_name, username, created_at)
-- VALUES ('<paste-user-id>', 'super_admin', 'Ardi', 'admin_ardi', now());
-- 
-- Note: role bisa 'super_admin' atau 'admin'

-- CARA 2: Bikin semua lewat SQL (recommended untuk development)
-- Ini akan bikin user di auth.users DAN profile sekaligus
-- UNCOMMENT dan ganti password sebelum run:

/*
-- Contoh: bikin super admin
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Insert ke supabase auth users
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'admin_ardi@internal-dashboard.local',
    crypt('password123', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO v_user_id;

  -- Insert ke profiles
  INSERT INTO profiles (id, role, full_name, username, created_at)
  VALUES (v_user_id, 'super_admin', 'Ardi', 'admin_ardi', now());

  RAISE NOTICE 'Created admin user with id: %', v_user_id;
END $$;
*/

-- ============================================
-- CARA 3: Bikin akun kiosk (user lapangan)
-- ============================================
-- Kiosk accounts sudah pakai username dari awal.
-- Bikin lewat admin dashboard: /admin/kiosk-accounts
-- Atau lewat SQL:

/*
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'kiosk_budi@internal-kiosk.local',
    crypt('password123', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO v_user_id;

  -- Insert ke kiosk_accounts (ganti project_id sesuai project yang ada)
  INSERT INTO kiosk_accounts (auth_user_id, username, project_id, is_active)
  VALUES (v_user_id, 'budi', '<ganti-project-id>', true);

  RAISE NOT NULL 'Created kiosk user with id: %', v_user_id;
END $$;
*/
