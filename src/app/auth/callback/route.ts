import { NextResponse, type NextRequest } from 'next/server'
import { type EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')

  // Target development localhost:3001 or configured origin
  const host = request.headers.get('host') || 'localhost:3001'
  let origin = 'http://localhost:3001'
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origin = process.env.NEXT_PUBLIC_SITE_URL
  } else if (!host.startsWith('localhost')) {
    const protocol = request.headers.get('x-forwarded-proto') || 'https'
    origin = `${protocol}://${host}`
  }

  // Handle errors provided directly in callback query parameters (e.g., link expired)
  if (error || error_description) {
    const errorMsg = error_description || error || 'Confirmation failed'
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorMsg)}`)
  }

  const supabase = await createClient()

  // 1. PKCE Code exchange flow
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      const destination = next.startsWith('/') ? next : '/dashboard'
      return NextResponse.redirect(`${origin}${destination}`)
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message || 'Invalid or expired confirmation code')}`
    )
  }

  // 2. Token hash / OTP verification flow
  if (token_hash && type) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash,
    })
    if (!verifyError) {
      const destination = next.startsWith('/') ? next : '/dashboard'
      return NextResponse.redirect(`${origin}${destination}`)
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(verifyError.message || 'Invalid or expired confirmation token')}`
    )
  }

  // 3. Fallback when neither code nor token_hash is present
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('No valid confirmation code or token found in confirmation link.')}`
  )
}
