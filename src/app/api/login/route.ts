import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createServiceClient, getClientIp, checkRateLimit, recordLoginAttempt, clearLoginAttempts, logServerError } from '@/lib/server-auth'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  let admin
  try {
    admin = createServiceClient()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const rateCheck = await checkRateLimit(admin, ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.error || 'Too many login attempts. Please try again in 1 minute.' },
        { status: 429 }
      )
    }

    const body = await req.json()
    const { mode, username, password } = body

    if (!username || !password) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }

    if (mode === 'admin') {
      const email = `admin_${username}@internal-dashboard.local`

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })

      if (authError || !authData.session) {
        await recordLoginAttempt(admin, ip)
        return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('id, role')
        .eq('id', authData.user.id)
        .in('role', ['admin', 'super_admin'])
        .maybeSingle()

      if (!profile) {
        await recordLoginAttempt(admin, ip)
        return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
      }

      await clearLoginAttempts(admin, ip)

      return NextResponse.json({
        session: authData.session,
        role: profile.role,
      })
    }

    const { data: kiosk } = await admin
      .from('kiosk_accounts')
      .select('id, auth_user_id, is_active, project_id')
      .eq('username', username)
      .maybeSingle()

    if (!kiosk) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    if (!kiosk.is_active) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Akun tidak aktif' }, { status: 403 })
    }

    const email = `kiosk_${username}@internal-kiosk.local`
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError || !authData.session) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    await admin
      .from('kiosk_accounts')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('username', username)

    await admin.from('kiosk_login_history').insert({
      kiosk_account_id: kiosk.id,
      username,
      project_id: kiosk.project_id,
      ip_address: ip,
      status: 'success',
    })

    await clearLoginAttempts(admin, ip)

    return NextResponse.json({
      session: authData.session,
      project_id: kiosk.project_id,
      role: 'kiosk',
    })
  } catch (err: unknown) {
    console.error('Login error:', err)
    await logServerError(admin, '/api/login', 'POST', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
