import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

/**
 * Checks whether the administrative service role key is configured.
 */
export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.trim() !== '')
}

/**
 * Creates an administrative Supabase client for scheduled cron jobs and background workers.
 * Uses SUPABASE_SERVICE_ROLE_KEY if defined to bypass RLS for system workflows,
 * or falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL and API Key must be configured in environment variables.')
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '[Supabase Admin] Notice: SUPABASE_SERVICE_ROLE_KEY is not configured. Falling back to NEXT_PUBLIC_SUPABASE_ANON_KEY. Note that background operations may be restricted by Row Level Security (RLS).'
    )
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
