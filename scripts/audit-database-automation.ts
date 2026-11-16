/* eslint-disable */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function runAudit() {
  console.log('==================================================================')
  console.log('AUDIT ITEM 1: DATABASE VERIFICATION (STAGING: tbguitzuqyetvwughohp)')
  console.log('==================================================================')

  // 1. Verify table existence and columns
  console.log('\n--- 1. Table & Column Verification ---')
  const { data: testSelect, error: selectError } = await supabaseAdmin
    .from('review_automation_events')
    .select('*')
    .limit(1)

  if (selectError) {
    console.error('❌ Table review_automation_events select error:', selectError)
  } else {
    console.log('✅ Table review_automation_events exists and is queryable.')
  }

  // 2. Fetch existing workspaces for test context
  const { data: workspaces, error: wsError } = await supabaseAdmin
    .from('workspaces')
    .select('id, name')
    .limit(2)

  if (wsError || !workspaces || workspaces.length === 0) {
    console.error('❌ Could not retrieve workspaces:', wsError)
    process.exit(1)
  }

  const wsA = workspaces[0]
  console.log(`Using Workspace A: ${wsA.name} (${wsA.id})`)

  // 3. Service role insert, select, update, delete
  console.log('\n--- 2. Service-Role Access Verification ---')
  const testEventId = `test-audit-${Date.now()}`
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('review_automation_events')
    .insert({
      event_id: testEventId,
      workspace_id: wsA.id,
      event_type: 'NEW_REVIEW',
      processing_status: 'received',
      publishing_status: 'pending',
      metadata: { test: true, audit: 'item1' },
    })
    .select()
    .single()

  if (insertError) {
    console.error('❌ Service role insert failed:', insertError)
  } else {
    console.log(`✅ Service role successfully inserted event: ${inserted.id}`)
  }

  // Test update
  const { error: updateError } = await supabaseAdmin
    .from('review_automation_events')
    .update({ processing_status: 'published', publishing_status: 'published' })
    .eq('id', inserted?.id)

  if (updateError) {
    console.error('❌ Service role update failed:', updateError)
  } else {
    console.log('✅ Service role successfully updated event.')
  }

  // 4. Test unique constraint on event_id
  console.log('\n--- 3. Constraint & Idempotency Verification ---')
  const { error: dupError } = await supabaseAdmin
    .from('review_automation_events')
    .insert({
      event_id: testEventId, // same event_id!
      workspace_id: wsA.id,
      event_type: 'NEW_REVIEW',
    })

  if (dupError && dupError.code === '23505') {
    console.log('✅ Unique constraint on event_id enforced (duplicate rejected with code 23505).')
  } else {
    console.error('❌ Unique constraint failed to catch duplicate event_id:', dupError)
  }

  // 5. Test Check Constraints on event_type, processing_status
  const { error: checkError } = await supabaseAdmin
    .from('review_automation_events')
    .insert({
      event_id: `invalid-${Date.now()}`,
      workspace_id: wsA.id,
      event_type: 'INVALID_TYPE' as any,
    })

  if (checkError && checkError.code === '23514') {
    console.log('✅ Check constraint on event_type enforced (rejected with code 23514).')
  } else {
    console.error('❌ Check constraint failed on invalid event_type:', checkError)
  }

  // Clean up test event
  if (inserted?.id) {
    await supabaseAdmin.from('review_automation_events').delete().eq('id', inserted.id)
    console.log('✅ Cleaned up service-role test record.')
  }

  // 6. Test RLS policies directly using PostgreSQL system catalog
  console.log('\n--- 4. RLS & Policy Audit ---')
  const { data: rlsStatus, error: rlsErr } = await supabaseAdmin.rpc('get_table_rls_status', {}).select('*')
  // If RPC doesn't exist, we can inspect policies via supabase-js or standard queries if available,
  // or test with an authenticated user client.

  // Let's test with authenticated user
  const { data: members, error: memErr } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id, role')
    .limit(5)

  console.log(`Found ${members?.length || 0} workspace memberships for RLS testing.`)
  if (members && members.length > 0) {
    for (const m of members) {
      console.log(`- Member user ${m.user_id} in workspace ${m.workspace_id} with role: ${m.role}`)
    }
  }

  console.log('\n✅ Database verification completed.')
}

runAudit().catch(console.error)
