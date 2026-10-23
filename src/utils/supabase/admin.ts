import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

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

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
