'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

export async function signup(prevState: { error: string; message?: string }, formData: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: 'Supabase configuration is missing. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file.' }
  }

  const supabase = await createClient()

  // Target development on localhost:3001, or custom site URL
  const headerList = await headers()
  const host = headerList.get('host') || 'localhost:3001'
  let origin = 'http://localhost:3001'
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origin = process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, '')
  } else if (!host.startsWith('localhost')) {
    const protocol = headerList.get('x-forwarded-proto') || 'https'
    origin = `${protocol}://${host}`
  }

  const emailRedirectTo = `${origin}/auth/callback`

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    options: {
      data: {
        full_name: formData.get('name') as string,
      },
      emailRedirectTo,
    }
  }

  const { data: authData, error } = await supabase.auth.signUp(data)

  if (error) {
    return { error: error.message }
  }

  // If email confirmation is disabled, session is returned immediately
  if (authData?.session?.user) {
    const cleanEmail = (formData.get('email') as string || '').trim().toLowerCase()
    try {
      const { createAdminClient } = await import('@/utils/supabase/admin')
      const adminClient = createAdminClient()
      const { data: pendingInvites } = await adminClient
        .from('workspace_invitations')
        .select('*')
        .eq('email', cleanEmail)

      if (pendingInvites && pendingInvites.length > 0) {
        for (const inv of pendingInvites) {
          if (new Date(inv.expires_at) >= new Date()) {
            await adminClient.from('workspace_members').upsert(
              {
                workspace_id: inv.workspace_id,
                user_id: authData.session.user.id,
                role: inv.role,
              },
              { onConflict: 'workspace_id,user_id' }
            )
          }
          await adminClient.from('workspace_invitations').delete().eq('id', inv.id)
        }
      }
    } catch (e) {
      console.warn('Failed auto-enrolling invited user on signup:', e)
    }

    revalidatePath('/', 'layout')
    redirect('/dashboard')
  }

  // If email confirmation is required, notify the user
  return {
    error: '',
    message: 'Account created! Please check your email for the confirmation link to complete registration.'
  }
}

