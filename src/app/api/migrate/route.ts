import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function POST() {
  // Guard: migration endpoint is only allowed in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Migrate endpoint disabled in production' }, { status: 403 })
  }

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  try {
    // Try to select username from profiles to check if column exists
    const { error: testErr } = await admin.from('profiles').select('username').limit(1)

    if (testErr && testErr.message.includes("column") && testErr.message.includes("username")) {
      // Column doesn't exist - need to add it via SQL
      // We'll use a workaround: create a temporary function and call it
      const { error: fnErr } = await admin.rpc('exec_migration', {
        sql: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text UNIQUE; CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);"
      })

      if (fnErr) {
        return NextResponse.json({
          error: 'username column missing and cannot auto-migrate',
          hint: 'Please run this SQL manually in Supabase SQL Editor:',
          sql: 'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text UNIQUE;\nCREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);',
          details: fnErr.message
        }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, message: 'username column exists or was added' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
