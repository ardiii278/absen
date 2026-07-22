import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { loginRequestSchema } from '@/lib/validators'
import { getClientIp, checkRateLimit, recordLoginAttempt, clearLoginAttempts } from '@/lib/server-auth'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    // 1. Rate Limiting Check using DB shared storage
    const rateCheck = await checkRateLimit(supabase, ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.error || 'Too many login attempts. Please try again in 1 minute.' },
        { status: 429 }
      )
    }

    // 2. Validate request body
    const body = await req.json()
    const parsed = loginRequestSchema.safeParse(body)
    if (!parsed.success) {
      // Record failed attempt for rate limiting
      await recordLoginAttempt(supabase, ip)
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const { username, password } = parsed.data

    // 3. Look up kiosk account
    const { data: kiosk, error: kioskError } = await supabase
      .from('kiosk_accounts')
      .select('auth_user_id, is_active, project_id')
      .eq('username', username)
      .maybeSingle()

    if (kioskError || !kiosk) {
      await recordLoginAttempt(supabase, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
    }

    // 4. Check if active - prevent leakage of existence
    if (!kiosk.is_active) {
      await recordLoginAttempt(supabase, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
    }

    // Map username internally to email format for Supabase Auth
    const email = `kiosk_${username}@internal-kiosk.local`

    // Attempt to log in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.session) {
      await recordLoginAttempt(supabase, ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 400 })
    }

    // Update last_seen_at
    await supabase
      .from('kiosk_accounts')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('username', username)

    // Record successful login in kiosk_login_history
    await supabase.from('kiosk_login_history').insert({
      kiosk_account_id: kiosk.id,
      username,
      project_id: kiosk.project_id,
      ip_address: ip,
      status: 'success'
    })

    // Clear rate limiting on success
    await clearLoginAttempts(supabase, ip)

    return NextResponse.json({
      session: authData.session,
      project_id: kiosk.project_id,
      role: 'kiosk'
    })
  } catch {
    // Sanitized generic error message - do not leak internals
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
