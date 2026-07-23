import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { loginRequestSchema } from '@/lib/validators'
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
    const parsed = loginRequestSchema.safeParse(body)
    if (!parsed.success) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const { username, password } = parsed.data

    const { data: kiosk, error: kioskError } = await admin
      .from('kiosk_accounts')
      .select('id, auth_user_id, is_active, project_id')
      .eq('username', username)
      .maybeSingle()

    if (kioskError || !kiosk) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
    }

    if (!kiosk.is_active) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
    }

    const email = `kiosk_${username}@internal-kiosk.local`
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError || !authData.session) {
      await recordLoginAttempt(admin, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
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
      status: 'success'
    })

    await clearLoginAttempts(admin, ip)

    return NextResponse.json({
      session: authData.session,
      project_id: kiosk.project_id,
      role: 'kiosk'
    })
  } catch (err: unknown) {
    console.error('Kiosk login error:', err)
    await logServerError(admin, '/api/kiosk-login', 'POST', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
