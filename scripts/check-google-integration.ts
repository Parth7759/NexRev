/* eslint-disable */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '../src/lib/encryption'

async function checkGoogleIntegration() {
  console.log('='.repeat(70))
  console.log('NexRep Google Business Profile Integration Read-Only Inspection')
  console.log('='.repeat(70))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    console.error('❌ Missing Supabase URL or Service Role Key.')
    process.exit(1)
  }

  const supabase = createClient(url, serviceRoleKey)

  // 1. Query google_integrations table
  console.log('\n1. Checking public.google_integrations table:')
  const { data: integrations, error: intError } = await supabase
    .from('google_integrations')
    .select('id, workspace_id, account_id, account_name, scope, expires_at, created_at, updated_at, access_token_encrypted, refresh_token_encrypted')

  if (intError) {
    console.error('❌ Error querying google_integrations:', intError.message)
    return
  }

  console.log(`Found ${integrations?.length ?? 0} Google integration record(s).`)

  if (!integrations || integrations.length === 0) {
    console.log('ℹ️ No active Google OAuth connection is currently stored in the database.')
    console.log('   The OAuth connection flow must be completed in /dashboard/locations or /api/auth/google/start.')
    return
  }

  for (let i = 0; i < integrations.length; i++) {
    const gi = integrations[i]
    const expiresAt = new Date(gi.expires_at)
    const isExpired = Date.now() > expiresAt.getTime()

    console.log(`\nIntegration #${i + 1}:`)
    console.log(`- Workspace ID: ${gi.workspace_id}`)
    console.log(`- Account ID: ${gi.account_id || '(Not set)'}`)
    console.log(`- Account Name: ${gi.account_name || '(Not set)'}`)
    console.log(`- Scope: ${gi.scope}`)
    console.log(`- Token Expires At: ${gi.expires_at} (${isExpired ? 'EXPIRED' : 'ACTIVE'})`)
    console.log(`- Has Access Token: ${Boolean(gi.access_token_encrypted)}`)
    console.log(`- Has Refresh Token: ${Boolean(gi.refresh_token_encrypted)}`)

    // Attempt token decryption without printing
    let decryptedAccess: string | null = null
    try {
      decryptedAccess = decryptToken(gi.access_token_encrypted)
      console.log('✅ Access token decrypted successfully.')
    } catch (e: any) {
      console.log('❌ Failed to decrypt access token:', e.message)
    }

    // If token is expired but refresh token exists, test refresh
    if (decryptedAccess && isExpired && gi.refresh_token_encrypted) {
      console.log('\nAttempting safe token refresh via https://oauth2.googleapis.com/token...')
      try {
        const decryptedRefresh = decryptToken(gi.refresh_token_encrypted)
        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET

        if (clientId && clientSecret) {
          const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId.trim(),
              client_secret: clientSecret.trim(),
              refresh_token: decryptedRefresh.trim(),
              grant_type: 'refresh_token',
            }).toString(),
          })

          const refreshJson = await refreshRes.json()
          if (refreshRes.ok && refreshJson.access_token) {
            console.log('✅ Google OAuth token refresh succeeded! Fresh access token received.')
            decryptedAccess = refreshJson.access_token
          } else {
            console.log(`⚠️ Token refresh response: HTTP ${refreshRes.status}`, refreshJson.error || refreshJson.error_description || '')
          }
        }
      } catch (err: any) {
        console.log('⚠️ Token refresh failed:', err.message)
      }
    }

    // Perform safe read-only API calls to verify enabled Google APIs
    if (decryptedAccess) {
      console.log('\n--- Programmatic Read-Only Google API Status Checks ---')

      // Check 1: My Business Account Management API
      console.log('Testing My Business Account Management API (mybusinessaccountmanagement.googleapis.com/v1/accounts)...')
      try {
        const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
          headers: {
            Authorization: `Bearer ${decryptedAccess}`,
            Accept: 'application/json',
          },
        })
        const accJson = await accRes.json().catch(() => null)
        console.log(`Account Management API HTTP Status: ${accRes.status}`)
        if (accRes.ok) {
          console.log('✅ My Business Account Management API is ENABLED and accessible!')
          console.log(`Accounts found: ${accJson?.accounts?.length || 0}`)
        } else {
          console.log(`❌ Account Management API error: [${accJson?.error?.code || accRes.status}] ${accJson?.error?.message || accRes.statusText}`)
        }
      } catch (err: any) {
        console.log('Error calling Account Management API:', err.message)
      }

      // Check 2: My Business Business Information API (Locations)
      console.log('\nTesting My Business Business Information API (mybusinessbusinessinformation.googleapis.com)...')
      try {
        const numericAccountId = gi.account_id || '108611198428245728238'
        const busInfoUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${numericAccountId}/locations?readMask=name,title,storefrontAddress`
        const busRes = await fetch(busInfoUrl, {
          headers: {
            Authorization: `Bearer ${decryptedAccess}`,
            Accept: 'application/json',
          },
        })
        const busJson = await busRes.json().catch(() => null)
        console.log(`Business Information API HTTP Status: ${busRes.status}`)
        if (busRes.ok) {
          console.log('✅ My Business Business Information API is ENABLED and accessible!')
          console.log(`Locations returned: ${busJson?.locations?.length || 0}`)
        } else {
          console.log(`❌ Business Information API error: [${busJson?.error?.code || busRes.status}] ${busJson?.error?.message || busRes.statusText}`)
        }
      } catch (err: any) {
        console.log('Error testing Business Information API:', err.message)
      }

      // Check 3: Google My Business API v4 (Reviews endpoint)
      console.log('\nTesting Google My Business API v4 Reviews Endpoint (mybusiness.googleapis.com/v4)...')
      try {
        const numericAccountId = gi.account_id || '108611198428245728238'
        const sampleLocationId = '4595848937945692927'
        const reviewsUrl = `https://mybusiness.googleapis.com/v4/accounts/${numericAccountId}/locations/${sampleLocationId}/reviews?pageSize=5`
        const revRes = await fetch(reviewsUrl, {
          headers: {
            Authorization: `Bearer ${decryptedAccess}`,
            Accept: 'application/json',
          },
        })
        const revJson = await revRes.json().catch(() => null)
        console.log(`Google My Business Reviews API (v4) HTTP Status: ${revRes.status}`)
        if (revRes.ok) {
          console.log('🎉 Google My Business API v4 (Reviews API) is ENABLED and ACCESSIBLE on project 248443327820!')
          console.log(`Reviews fetched: ${revJson?.reviews?.length || 0}`)
        } else {
          console.log(`Result: [${revJson?.error?.code || revRes.status}] ${revJson?.error?.message || revRes.statusText}`)
          if (revJson?.error?.message?.includes('has not been used') || revJson?.error?.message?.includes('disabled')) {
            console.log('👉 CONFIRMED BLOCKER: Google My Business API is NOT enabled on Google Cloud project 248443327820.')
          } else if (revRes.status === 403) {
            console.log('👉 CONFIRMED BLOCKER: Access not granted or permission denied (403 Forbidden).')
          }
        }
      } catch (err: any) {
        console.log('Error testing Reviews API:', err.message)
      }
    }
  }

  // 2. Check locations table
  console.log('\n2. Checking public.locations table:')
  const { data: locs, error: locErr } = await supabase
    .from('locations')
    .select('id, workspace_id, name, google_location_id, google_account_id, is_connected')

  if (locErr) {
    console.error('Error querying locations:', locErr.message)
  } else {
    console.log(`Found ${locs?.length || 0} location(s) in database.`)
    for (const l of (locs || [])) {
      console.log(`- Location: "${l.name}" | Google Location ID: ${l.google_location_id || '(None)'} | Google Account ID: ${l.google_account_id || '(None)'} | Connected: ${l.is_connected}`)
    }
  }
}

checkGoogleIntegration().catch(err => {
  console.error('Check script error:', err.message)
  process.exit(1)
})
