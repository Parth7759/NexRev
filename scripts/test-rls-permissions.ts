/* eslint-disable */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function testRlsPermissions() {
  console.log('--- Testing RLS Policies & Ordinary Member Permissions on Staging ---')

  const testEmail = `test-member-${Date.now()}@nexrep-test.local`
  const testPassword = 'TestPassword123!@#'

  // 1. Create a temporary member user
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  })

  if (userError || !userData?.user) {
    console.error('Failed to create test member user:', userError)
    return
  }

  const testUserId = userData.user.id
  console.log(`Created test user: ${testUserId} (${testEmail})`)

  try {
    // 2. Get workspace
    const { data: workspaces } = await admin.from('workspaces').select('id, name').limit(1)
    const ws = workspaces![0]

    // 3. Add user as ordinary 'member' (NOT admin/owner)
    const { error: memberError } = await admin.from('workspace_members').insert({
      workspace_id: ws.id,
      user_id: testUserId,
      role: 'member',
    })

    if (memberError) {
      console.error('Failed to add workspace member:', memberError)
      return
    }
    console.log(`Added test user to workspace ${ws.id} with role: 'member'`)

    // 4. Insert a test event via service role
    const eventId = `audit-event-${Date.now()}`
    const { data: eventData, error: eventInsertErr } = await admin
      .from('review_automation_events')
      .insert({
        event_id: eventId,
        workspace_id: ws.id,
        event_type: 'NEW_REVIEW',
        processing_status: 'received',
      })
      .select()
      .single()

    if (eventInsertErr) {
      console.error('Failed to insert audit event via service role:', eventInsertErr)
      return
    }

    // 5. Sign in as test member using anon client
    const memberClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: signInData, error: signInErr } = await memberClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })

    if (signInErr) {
      console.error('Failed to sign in as member:', signInErr)
      return
    }
    console.log('Signed in successfully as member.')

    // 6. Test SELECT: Ordinary member SHOULD be able to view events
    const { data: memberSelect, error: memberSelectErr } = await memberClient
      .from('review_automation_events')
      .select('*')
      .eq('id', eventData.id)

    if (!memberSelectErr && memberSelect && memberSelect.length === 1) {
      console.log('✅ PASS: Ordinary member CAN view workspace review_automation_events (SELECT allowed).')
    } else {
      console.error('❌ FAIL: Ordinary member failed to view event:', memberSelectErr, memberSelect)
    }

    // 7. Test INSERT: Ordinary member should NOT be able to insert event records
    const { error: memberInsertErr } = await memberClient
      .from('review_automation_events')
      .insert({
        event_id: `tamper-${Date.now()}`,
        workspace_id: ws.id,
        event_type: 'NEW_REVIEW',
      })

    if (memberInsertErr) {
      console.log(`✅ PASS: Ordinary member CANNOT insert event records (Blocked: ${memberInsertErr.message}).`)
    } else {
      console.error('❌ FAIL: Ordinary member was able to insert event record!')
    }

    // 8. Test UPDATE: Ordinary member should NOT be able to update event records
    const { error: memberUpdateErr } = await memberClient
      .from('review_automation_events')
      .update({ processing_status: 'published' })
      .eq('id', eventData.id)

    // Note: in Supabase RLS, UPDATE on unpermitted row either throws an error or updates 0 rows
    const { data: checkAfterUpdate } = await admin
      .from('review_automation_events')
      .select('processing_status')
      .eq('id', eventData.id)
      .single()

    if (memberUpdateErr || checkAfterUpdate?.processing_status === 'received') {
      console.log('✅ PASS: Ordinary member CANNOT modify/tamper with event records (Update was prevented).')
    } else {
      console.error('❌ FAIL: Ordinary member was able to update event record!')
    }

    // 9. Test DELETE: Ordinary member should NOT be able to delete event records
    const { error: memberDeleteErr } = await memberClient
      .from('review_automation_events')
      .delete()
      .eq('id', eventData.id)

    const { data: checkAfterDelete } = await admin
      .from('review_automation_events')
      .select('id')
      .eq('id', eventData.id)
      .single()

    if (checkAfterDelete?.id) {
      console.log('✅ PASS: Ordinary member CANNOT delete event records (Record preserved).')
    } else {
      console.error('❌ FAIL: Ordinary member was able to delete event record!')
    }

    // Clean up event
    await admin.from('review_automation_events').delete().eq('id', eventData.id)
  } finally {
    // Clean up user and membership
    await admin.from('workspace_members').delete().eq('user_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
    console.log('✅ Cleaned up temporary test member user and membership.')
  }
}

testRlsPermissions().catch(console.error)
