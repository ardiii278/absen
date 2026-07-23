import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function POST() {
  // Guard: seeding is only allowed in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Seed endpoint disabled in production' }, { status: 403 })
  }

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const results: string[] = []
  const errors: string[] = []

  try {
    // ============================================
    // 1. PROJECTS
    // ============================================
    const projects = [
      { code: 'PDB', name: 'Podomoro Park Bandung', lat: -6.9175, lng: 107.6191, radius_m: 500 },
      { code: 'SMB', name: 'Summarecon Bogor', lat: -6.5944, lng: 106.7892, radius_m: 400 },
    ]

    const projectIds: Record<string, string> = {}

    for (const proj of projects) {
      const { data: existing } = await admin.from('projects').select('id').eq('code', proj.code).maybeSingle()
      if (existing) {
        projectIds[proj.code] = existing.id
      } else {
        const { data, error } = await admin.from('projects').insert(proj).select('id').single()
        if (error) { errors.push(`Project ${proj.code}: ${error.message}`); continue }
        if (data) projectIds[proj.code] = data.id
      }
    }
    results.push(`Projects: ${Object.entries(projectIds).map(([k, v]) => `${k}=${v.slice(0,8)}`).join(', ')}`)

    const pdbId = projectIds['PDB']
    const smbId = projectIds['SMB']

    if (!pdbId || !smbId) {
      return NextResponse.json({ error: 'Failed to create/find projects', results, errors }, { status: 500 })
    }

    // ============================================
    // 2. AUTH USERS + PROFILES
    // ============================================
    const usersToCreate = [
      { username: 'superadmin', password: 'Admin123!', role: 'super_admin', fullName: 'Super Administrator', email: 'admin_superadmin@internal-dashboard.local' },
      { username: 'adminpdb', password: 'Admin123!', role: 'admin', fullName: 'Admin Podomoro', email: 'admin_adminpdb@internal-dashboard.local' },
      { username: 'kioskpdb', password: 'Kiosk123!', role: 'kiosk', fullName: 'Kiosk Podomoro', email: 'kiosk_kioskpdb@internal-kiosk.local' },
      { username: 'kiosksmb', password: 'Kiosk123!', role: 'kiosk', fullName: 'Kiosk Summarecon', email: 'kiosk_kiosksmb@internal-kiosk.local' },
    ]

    const createdUsers: Record<string, { id: string; role: string }> = {}

    // Pre-fetch all auth users once
    const { data: allAuthUsers } = await admin.auth.admin.listUsers()
    const authUserMap = new Map<string, string>()
    if (allAuthUsers?.users) {
      for (const au of allAuthUsers.users) {
        if (au.email) authUserMap.set(au.email, au.id)
      }
    }

    for (const u of usersToCreate) {
      let userId = authUserMap.get(u.email)

      if (!userId) {
        // Create auth user
        const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { username: u.username }
        })
        if (authErr || !authUser.user) {
          errors.push(`Auth user ${u.username}: ${authErr?.message || 'unknown error'}`)
          continue
        }
        userId = authUser.user.id
      }

      createdUsers[u.username] = { id: userId, role: u.role }

      // Check if profile already exists
      const { data: existingProfile } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
      if (existingProfile) {
        results.push(`User ${u.username} already exists`)
        continue
      }

      // Insert profile (try with username column first, fallback without)
      const { error: profileErr } = await admin.from('profiles').insert({
        id: userId,
        role: u.role,
        full_name: u.fullName,
        username: u.username
      })

      if (profileErr && profileErr.message.includes('username')) {
        const { error: fallbackErr } = await admin.from('profiles').insert({
          id: userId,
          role: u.role,
          full_name: u.fullName,
        })
        if (fallbackErr) {
          errors.push(`Profile ${u.username}: ${fallbackErr.message}`)
          continue
        }
        results.push(`Created user: ${u.username} (${u.role}) [no username column]`)
      } else if (profileErr) {
        errors.push(`Profile ${u.username}: ${profileErr.message}`)
        continue
      } else {
        results.push(`Created user: ${u.username} (${u.role})`)
      }
    }

    // ============================================
    // 3. ADMIN_PROJECTS
    // ============================================
    const adminPdb = createdUsers['adminpdb']
    const superAdmin = createdUsers['superadmin']

    if (adminPdb) {
      const { error } = await admin.from('admin_projects').upsert(
        [
          { user_id: adminPdb.id, project_id: pdbId },
          { user_id: adminPdb.id, project_id: smbId },
        ],
        { onConflict: 'user_id,project_id' }
      )
      if (error) errors.push(`admin_projects: ${error.message}`)
      else results.push('Admin project mappings created')
    }

    if (superAdmin) {
      await admin.from('admin_projects').upsert(
        [
          { user_id: superAdmin.id, project_id: pdbId },
          { user_id: superAdmin.id, project_id: smbId },
        ],
        { onConflict: 'user_id,project_id' }
      )
    }

    // ============================================
    // 4. KIOSK_ACCOUNTS
    // ============================================
    const kioskUsers = [
      { username: 'kioskpdb', projectId: pdbId },
      { username: 'kiosksmb', projectId: smbId },
    ]

    for (const k of kioskUsers) {
      const kUser = createdUsers[k.username]
      if (!kUser) continue

      const { error } = await admin.from('kiosk_accounts').upsert(
        { auth_user_id: kUser.id, username: k.username, project_id: k.projectId, is_active: true },
        { onConflict: 'username' }
      )
      if (error) errors.push(`Kiosk ${k.username}: ${error.message}`)
      else results.push(`Kiosk account: ${k.username}`)
    }

    // ============================================
    // 5. WORKERS (with face descriptors)
    // ============================================
    const workersData = [
      { nik: '3201234567890001', name: 'Pepen Suryana', position: 'TK', job_scope: 'HARDSCAPE CLUSTER PATRAGRIYA', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890002', name: 'Ahmad Ridwan', position: 'TK', job_scope: 'HARDSCAPE CLUSTER PATRAGRIYA', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890003', name: 'Dedi Supriadi', position: 'KN', job_scope: 'STRUKTUR BANGUNAN', project_id: pdbId, daily_wage: 250000 },
      { nik: '3201234567890004', name: 'Ujang Sutarja', position: 'TK', job_scope: 'FINISHING INTERIOR', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890005', name: 'Asep Saepudin', position: 'TK', job_scope: 'HARDSCAPE CLUSTER PATRAGRIYA', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890006', name: 'Wawan Setiawan', position: 'KN', job_scope: 'MEKANIKAL ELEKTRIKAL', project_id: pdbId, daily_wage: 250000 },
      { nik: '3201234567890007', name: 'Encep Nurjaman', position: 'TK', job_scope: 'STRUKTUR BANGUNAN', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890008', name: 'Dani Kuswanto', position: 'TK', job_scope: 'HARDSCAPE CLUSTER PATRAGRIYA', project_id: pdbId, daily_wage: 150000 },
      { nik: '3201234567890009', name: 'Rudi Hartono', position: 'TK', job_scope: 'LANDSCAPING', project_id: smbId, daily_wage: 150000 },
      { nik: '3201234567890010', name: 'Sugeng Riyadi', position: 'KN', job_scope: 'STRUKTUR BANGUNAN', project_id: smbId, daily_wage: 250000 },
      { nik: '3201234567890011', name: 'Budi Santoso', position: 'TK', job_scope: 'FINISHING EKSTERIOR', project_id: smbId, daily_wage: 150000 },
      { nik: '3201234567890012', name: 'Hendra Gunawan', position: 'TK', job_scope: 'LANDSCAPING', project_id: smbId, daily_wage: 150000 },
      { nik: '3201234567890013', name: 'Pending Worker', position: 'TK', job_scope: 'HARDSCAPE', project_id: pdbId, daily_wage: 150000 },
    ]

    const workerIds: Record<string, string> = {}

    for (const w of workersData) {
      const { data: existingW } = await admin.from('workers').select('id').eq('nik', w.nik).maybeSingle()
      if (existingW) {
        workerIds[w.nik] = existingW.id
        continue
      }

      const isPending = w.nik === '3201234567890013'
      const faceDescriptor = isPending ? null : Array.from({ length: 128 }, () => Math.random() * 2 - 1)

      const { data: newW, error: wErr } = await admin.from('workers').insert({
        ...w,
        status: isPending ? 'pending_approval' : 'approved',
        is_active: !isPending,
        profile_path: 'temp/placeholder_profile.jpg',
        face_descriptor: faceDescriptor
      }).select('id').single()

      if (wErr) { errors.push(`Worker ${w.name}: ${wErr.message}`); continue }
      if (newW) workerIds[w.nik] = newW.id
      results.push(`Worker: ${w.name} (${isPending ? 'pending' : 'active'})`)
    }

    // ============================================
    // 6. ATTENDANCE (today's records)
    // ============================================
    const today = new Date().toISOString().split('T')[0]
    const { count: existingAttCount } = await admin.from('attendance').select('id', { count: 'exact', head: true })
      .gte('occurred_at', `${today}T00:00:00Z`)

    if (existingAttCount && existingAttCount > 0) {
      results.push(`Attendance already exists for today (${existingAttCount} records)`)
    } else {
      const now = new Date()
      const attendanceRecords = []

      // Create IN records for first 5 PDB workers
      const pdbWorkerNiks = ['3201234567890001', '3201234567890002', '3201234567890003', '3201234567890004', '3201234567890005']
      for (let i = 0; i < pdbWorkerNiks.length; i++) {
        const wid = workerIds[pdbWorkerNiks[i]]
        if (!wid) continue

        const inTime = new Date(now)
        inTime.setHours(7, 0 + i * 3, 0, 0)

        attendanceRecords.push({
          client_event_id: crypto.randomUUID(),
          worker_id: wid,
          project_id: pdbId,
          type: 'in',
          occurred_at: inTime.toISOString(),
          gps: { latitude: -6.9175, longitude: 107.6191 },
          source: i % 2 === 0 ? 'face' : 'manual',
          status: 'approved'
        })

        // Add OUT for first 2 workers
        if (i < 2) {
          const outTime = new Date(now)
          outTime.setHours(16, 0 + i * 5, 0, 0)

          attendanceRecords.push({
            client_event_id: crypto.randomUUID(),
            worker_id: wid,
            project_id: pdbId,
            type: 'out',
            occurred_at: outTime.toISOString(),
            gps: { latitude: -6.9175, longitude: 107.6191 },
            source: 'face',
            status: 'approved'
          })
        }
      }

      // Create IN records for first 3 SMB workers
      const smbWorkerNiks = ['3201234567890009', '3201234567890010', '3201234567890011']
      for (let i = 0; i < smbWorkerNiks.length; i++) {
        const wid = workerIds[smbWorkerNiks[i]]
        if (!wid) continue

        const inTime = new Date(now)
        inTime.setHours(7, 15 + i * 5, 0, 0)

        attendanceRecords.push({
          client_event_id: crypto.randomUUID(),
          worker_id: wid,
          project_id: smbId,
          type: 'in',
          occurred_at: inTime.toISOString(),
          gps: { latitude: -6.5944, longitude: 106.7892 },
          source: 'face',
          status: 'approved'
        })
      }

      if (attendanceRecords.length > 0) {
        const { error: attErr } = await admin.from('attendance').insert(attendanceRecords)
        if (attErr) errors.push(`Attendance: ${attErr.message}`)
        else results.push(`Attendance created: ${attendanceRecords.length} records`)
      }
    }

    // ============================================
    // 7. AUDIT LOG
    // ============================================
    if (superAdmin) {
      await admin.from('audit_logs').insert({
        actor_id: superAdmin.id,
        entity_type: 'system',
        entity_id: 'seed',
        action: 'SEED_DATA',
        reason: 'Initial seed data created for development/testing'
      })
    }

    return NextResponse.json({
      success: true,
      results,
      errors,
      credentials: {
        admin: { username: 'superadmin', password: 'Admin123!' },
        adminProject: { username: 'adminpdb', password: 'Admin123!' },
        kioskPDB: { username: 'kioskpdb', password: 'Kiosk123!' },
        kioskSMB: { username: 'kiosksmb', password: 'Kiosk123!' },
      }
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg, results, errors }, { status: 500 })
  }
}
