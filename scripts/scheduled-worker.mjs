#!/usr/bin/env node
/**
 * NexRep Local Background Scheduler & Worker
 *
 * Runs scheduled review processing on a recurring timer in local development,
 * simulating what Vercel Cron or a Cloud Scheduler executes in production.
 *
 * Usage:
 *   node scripts/scheduled-worker.mjs --once
 *   node scripts/scheduled-worker.mjs --interval=30 --dryRun
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const args = process.argv.slice(2)
const isOnce = args.includes('--once')
const isDryRun = args.includes('--dryRun') || args.includes('--dry-run')
const intervalArg = args.find((a) => a.startsWith('--interval='))
const intervalSeconds = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 60
const port = process.env.PORT || 3001
const baseUrl = `http://localhost:${port}`

console.log('='.repeat(70))
console.log('NexRep Automated Review Scheduler & Background Worker')
console.log(`Endpoint: ${baseUrl}/api/cron/process-replies`)
console.log(`Mode: ${isOnce ? 'Single Run (--once)' : `Recurring every ${intervalSeconds}s`}`)
console.log(`Dry Run: ${isDryRun ? 'ENABLED (Zero external API calls)' : 'DISABLED (Live policy execution)'}`)
console.log('='.repeat(70))

async function runScheduledTick() {
  const timestamp = new Date().toISOString()
  console.log(`\n[${timestamp}] ⏱️ Triggering automated review processing...`)

  try {
    const url = new URL(`${baseUrl}/api/cron/process-replies`)
    if (isDryRun) url.searchParams.set('dryRun', 'true')
    if (process.env.CRON_SECRET) url.searchParams.set('secret', process.env.CRON_SECRET)

    const headers = {}
    if (process.env.CRON_SECRET) {
      headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      console.error(`❌ Scheduler returned HTTP ${res.status}:`, data?.error || res.statusText)
      return { success: false, status: res.status, error: data?.error }
    }

    console.log(`✅ Scheduler tick complete:`)
    console.log(`   - Scanned: ${data.scanned} reviews`)
    console.log(`   - Processed: ${data.processed}`)
    console.log(`   - Drafts Created: ${data.draftsCreated}`)
    console.log(`   - Auto-Published: ${data.published}`)
    console.log(`   - Skipped: ${data.skipped}`)
    console.log(`   - Errors: ${data.failed}`)

    return { success: true, data }
  } catch (err) {
    console.error('❌ Scheduler communication error:', err.message)
    return { success: false, error: err.message }
  }
}

// Execute immediately
const initialRun = await runScheduledTick()

if (isOnce) {
  process.exit(initialRun.success ? 0 : 1)
}

// Start recurring timer
console.log(`\nScheduler running. Press Ctrl+C to terminate.`)
setInterval(runScheduledTick, intervalSeconds * 1000)
