import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { Database, Json } from '../../db/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServiceClient(): any {
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

export type AppRole = 'super_admin' | 'admin' | 'kiosk'

export interface AuthContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  user: {
    id: string
    email?: string
  }
  profile: {
    id: string
    role: AppRole
    full_name: string | null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRequestClient(token: string): any {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

export async function verifyAuth(req: NextRequest): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Error('UNAUTHORIZED')
  }

  const token = authHeader.replace('Bearer ', '')
  if (!token) {
    throw new Error('UNAUTHORIZED')
  }

  // Create client scoped to this request/token
  const client = createRequestClient(token)

  // Verify the JWT is valid and get user info
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user) {
    throw new Error('UNAUTHORIZED')
  }

  // Fetch the role from profile using the scoped client to respect RLS
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Error('FORBIDDEN')
  }

  return {
    client,
    user: { id: user.id, email: user.email },
    profile: {
      id: profile.id,
      role: profile.role as AppRole,
      full_name: profile.full_name
    }
  }
}

export async function verifyProjectAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string,
  role: AppRole,
  projectId: string
): Promise<boolean> {
  if (role === 'super_admin') {
    return true
  }

  if (role === 'admin') {
    const { data, error } = await client
      .from('admin_projects')
      .select('project_id')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .maybeSingle()

    return !error && !!data
  }

  if (role === 'kiosk') {
    const { data, error } = await client
      .from('kiosk_accounts')
      .select('project_id, is_active')
      .eq('auth_user_id', userId)
      .eq('project_id', projectId)
      .maybeSingle()

    return !error && !!data && data.is_active
  }

  return false
}

export async function createAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  reason: string | null = null,
  oldData: unknown = null,
  newData: unknown = null
): Promise<void> {
  const { error } = await client.from('audit_logs').insert({
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action: action,
    reason: reason,
    old_data: oldData as Json,
    new_data: newData as Json
  })
  if (error) {
    console.error('Failed to write audit log:', error.message)
  }
}

export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const parts = forwardedFor.split(',')
    if (parts.length > 0 && parts[0]) {
      return parts[0].trim()
    }
  }
  return 'local'
}

export async function checkRateLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ip: string
): Promise<{ allowed: boolean; error?: string }> {
  const { data, error } = await client
    .from('login_attempts')
    .select('attempts, last_attempt')
    .eq('ip_address', ip)
    .maybeSingle()

  if (error) {
    console.error('Rate limit DB check error:', error.message)
    return { allowed: true }
  }

  if (!data) {
    return { allowed: true }
  }

  const now = new Date().getTime()
  const lastAttemptTime = new Date(data.last_attempt).getTime()
  const diff = now - lastAttemptTime

  if (data.attempts >= 5 && diff < 60000) {
    return { allowed: false, error: 'Too many login attempts. Please try again in 1 minute.' }
  }

  return { allowed: true }
}

export async function recordLoginAttempt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ip: string
): Promise<void> {
  const { data, error: selectErr } = await client
    .from('login_attempts')
    .select('attempts, last_attempt')
    .eq('ip_address', ip)
    .maybeSingle()

  if (selectErr) return

  const nowStr = new Date().toISOString()

  if (!data) {
    await client.from('login_attempts').insert({
      ip_address: ip,
      attempts: 1,
      last_attempt: nowStr
    })
  } else {
    const lastAttemptTime = new Date(data.last_attempt).getTime()
    const diff = new Date().getTime() - lastAttemptTime
    let newAttempts = data.attempts + 1
    if (diff >= 60000) {
      newAttempts = 1
    }
    await client.from('login_attempts').update({
      attempts: newAttempts,
      last_attempt: nowStr
    }).eq('ip_address', ip)
  }
}

export async function clearLoginAttempts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ip: string
): Promise<void> {
  await client.from('login_attempts').delete().eq('ip_address', ip)
}

export async function getProjectTimezoneOffset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  projectId: string
): Promise<number> {
  const { data } = await client
    .from('projects')
    .select('lng')
    .eq('id', projectId)
    .maybeSingle()

  let offsetHours = 7 // Default WIB (UTC+7)
  if (data && data.lng !== null) {
    const lng = Number(data.lng)
    if (lng >= 135.0) {
      offsetHours = 9 // WIT (UTC+9)
    } else if (lng >= 120.0) {
      offsetHours = 8 // WITA (UTC+8)
    }
  }
  return offsetHours
}

export function getProjectLocalDayBoundaries(
  occurredAtStr: string,
  offsetHours: number
): { localDateStr: string; startUtcStr: string; endUtcStr: string } {
  const occurredDateObj = new Date(occurredAtStr)
  // Convert UTC time to local project time
  const localTimeMs = occurredDateObj.getTime() + (offsetHours * 60 * 60 * 1000)
  const localDateStr = new Date(localTimeMs).toISOString().split('T')[0]

  const localStart = new Date(`${localDateStr}T00:00:00Z`)
  localStart.setUTCHours(localStart.getUTCHours() - offsetHours)
  const startUtcStr = localStart.toISOString()

  const localEnd = new Date(`${localDateStr}T23:59:59.999Z`)
  localEnd.setUTCHours(localEnd.getUTCHours() - offsetHours)
  const endUtcStr = localEnd.toISOString()

  return { localDateStr, startUtcStr, endUtcStr }
}

export function getProjectDateRangeBoundaries(
  startDate: string,
  endDate: string,
  offsetHours: number
): { startUtcStr: string; endUtcStr: string } {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  start.setUTCHours(start.getUTCHours() - offsetHours)
  const end = new Date(`${endDate}T23:59:59.999Z`)
  end.setUTCHours(end.getUTCHours() - offsetHours)
  return { startUtcStr: start.toISOString(), endUtcStr: end.toISOString() }
}

export async function logServerError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  pathname: string,
  method: string,
  error: unknown,
  userId: string | null = null
): Promise<void> {
  try {
    let errorMessage = 'Unknown error'
    let stackTrace = ''

    if (error instanceof Error) {
      errorMessage = error.message
      stackTrace = error.stack || ''
    } else if (error && typeof error === 'object') {
      errorMessage = JSON.stringify(error)
      if ('message' in error && typeof error.message === 'string') {
        errorMessage = error.message
      }
      if ('stack' in error && typeof error.stack === 'string') {
        stackTrace = error.stack
      }
    } else if (typeof error === 'string') {
      errorMessage = error
    }

    await client.from('error_logs').insert({
      pathname,
      method,
      error_message: errorMessage,
      stack_trace: stackTrace,
      user_id: userId
    })
  } catch (err) {
    console.error('Failed to save server error log:', err)
  }
}
