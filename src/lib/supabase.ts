import { createClient } from '@supabase/supabase-js'
import { Database } from '../../db/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = createClient<Database>(supabaseUrl, supabaseAnonKey)
