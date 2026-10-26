import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

async function checkDatabaseState() {
  console.log('='.repeat(70))
  console.log('NexRep Automatic Publishing Readiness Read-Only DB Audit')
  console.log('='.repeat(70))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    console.error('❌ Supabase credentials missing in .env.local')
    process.exit(1)
  }

  const supabase = createClient(url, anonKey)

  // 1. Check workspace_settings table existence and schema
  console.log('\n1. Checking workspace_settings table:')
  const { data: wsData, error: wsError } = await supabase
    .from('workspace_settings')
    .select('*')
    .limit(5)

  if (wsError) {
    console.log(`❌ workspace_settings query error: [${wsError.code}] ${wsError.message}`)
    if (wsError.code === 'PGRST205' || wsError.message?.includes('schema cache') || wsError.message?.includes('does not exist')) {
      console.log('👉 ACTION REQUIRED: Migration 20261022000000_add_reply_safety_and_settings.sql has NOT been run on this Supabase project.')
    }
  } else {
    console.log(`✅ workspace_settings table exists! Rows retrieved: ${wsData?.length ?? 0}`)
    if (wsData && wsData.length > 0) {
      console.log('Sample settings row:', JSON.stringify(wsData[0], null, 2))
    }
  }

  // 2. Check review_reply_logs table
  console.log('\n2. Checking review_reply_logs table:')
  const { error: logError } = await supabase
    .from('review_reply_logs')
    .select('id')
    .limit(1)

  if (logError) {
    console.log(`❌ review_reply_logs query error: [${logError.code}] ${logError.message}`)
  } else {
    console.log(`✅ review_reply_logs table exists!`)
  }

  // 3. Check reviews and locations
  console.log('\n3. Checking reviews table:')
  const { data: reviewsData, error: reviewsError } = await supabase
    .from('reviews')
    .select('id, rating, status, author_name, content, external_review_id, location_id')
    .limit(10)

  if (reviewsError) {
    console.log(`ℹ️ reviews query error (likely RLS for unauthenticated client): [${reviewsError.code}] ${reviewsError.message}`)
  } else {
    console.log(`✅ reviews query returned ${reviewsData?.length ?? 0} reviews accessible via anon client.`)
  }

  // 4. Check locations table
  console.log('\n4. Checking locations table:')
  const { data: locData, error: locError } = await supabase
    .from('locations')
    .select('id, name, google_location_id, google_account_id, is_connected')
    .limit(10)

  if (locError) {
    console.log(`ℹ️ locations query error: [${locError.code}] ${locError.message}`)
  } else {
    console.log(`✅ locations query returned ${locData?.length ?? 0} locations accessible via anon client.`)
  }

  // 5. Check google_integrations table
  console.log('\n5. Checking google_integrations table:')
  const { data: gData, error: gError } = await supabase
    .from('google_integrations')
    .select('id, workspace_id, account_id, account_name, scope, expires_at')
    .limit(5)

  if (gError) {
    console.log(`ℹ️ google_integrations query error: [${gError.code}] ${gError.message}`)
  } else {
    console.log(`✅ google_integrations query returned ${gData?.length ?? 0} rows.`)
  }
}

checkDatabaseState().catch(err => {
  console.error('Audit script failure:', err.message)
  process.exit(1)
})
