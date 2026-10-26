/**
 * Comprehensive Verification Script: NexRep Branding & Dashboard Business Name
 * Validates:
 * 1. NexRep Branding across sidebar, header, welcome modal, invite page, and reports
 * 2. Zero instances of "SaaS" beside "NexRep"
 * 3. Dashboard full business name display without truncation or "..."
 * 4. Review Inbox selector isolation (unmodified compact layout)
 * 5. Branding SVG assets integration & metadata favicon
 */

import * as fs from 'fs'
import * as path from 'path'

const rootDir = process.cwd()
let passed = 0
let failed = 0

function assert(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`)
    passed++
  } else {
    console.error(`  ❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`)
    failed++
  }
}

console.log('='.repeat(80))
console.log('NexRep Branding, Business Name & Asset Integration Verification')
console.log('='.repeat(80))

// ---------------------------------------------------------------------------
// 1. Branding Assets in public/assets/branding & src/components/brand/logo.tsx
// ---------------------------------------------------------------------------
console.log('\n--- 1. Branding Assets & Logo Integration ---')

const assetsDir = path.join(rootDir, 'public/assets/branding')
const requiredAssets = [
  'favicon.svg',
  'nexrep-icon.svg',
  'nexrep-logo-dark.svg',
  'nexrep-logo-light.svg',
  'nexrep-logo.svg',
]

for (const asset of requiredAssets) {
  const filePath = path.join(assetsDir, asset)
  const exists = fs.existsSync(filePath)
  const isSvg = exists && fs.readFileSync(filePath, 'utf-8').includes('<svg')
  assert(`Asset ${asset} exists and is valid SVG`, exists && isSvg)
}

const logoCode = fs.readFileSync(path.join(rootDir, 'src/components/brand/logo.tsx'), 'utf-8')
assert('Logo component exports NexRepIcon', logoCode.includes('export function NexRepIcon'))
assert('Logo component exports NexRepLogo', logoCode.includes('export function NexRepLogo'))
assert('Logo component supports dark and light variants', logoCode.includes('variant = "dark"') && logoCode.includes('isDark'))
assert('Logo component displays tagline "by NexFlowOps"', logoCode.includes('by NexFlowOps'))

const iconSvgContent = fs.readFileSync(path.join(assetsDir, 'nexrep-icon.svg'), 'utf-8')
assert('Icon SVG contains rounded-square squircle base', iconSvgContent.includes('rx="12"') || iconSvgContent.includes('rx="10"'))
assert('Icon SVG contains customer review speech bubble', iconSvgContent.includes('Review Speech Bubble') || iconSvgContent.includes('d="M12.5 13'))
assert('Icon SVG contains rating star emblem', iconSvgContent.includes('Star') || iconSvgContent.includes('url(#nr-star)'))
assert('Icon SVG contains upward growth arrow', iconSvgContent.includes('Growth Arrow') || iconSvgContent.includes('url(#nr-accent)'))

const layoutCode = fs.readFileSync(path.join(rootDir, 'src/app/layout.tsx'), 'utf-8')
assert('Favicon configured in layout metadata', layoutCode.includes('/assets/branding/favicon.svg'))
assert('Apple touch icon configured in layout metadata', layoutCode.includes('/assets/branding/nexrep-icon.svg'))

// ---------------------------------------------------------------------------
// 2. NexRep Branding Verification Across App (No "SaaS" beside NexRep)
// ---------------------------------------------------------------------------
console.log('\n--- 2. NexRep Branding Consistency & Tagline Placement ---')

const sidebarCode = fs.readFileSync(path.join(rootDir, 'src/components/layout/sidebar.tsx'), 'utf-8')
assert('Sidebar imports NexRepLogo', sidebarCode.includes('import { NexRepLogo } from "@/components/brand/logo"'))
assert('Sidebar renders NexRepLogo with dark variant and tagline', sidebarCode.includes('<NexRepLogo variant="dark" showTagline={true} />'))
assert('Sidebar brand link points to /dashboard', sidebarCode.includes('<Link href="/dashboard" className="flex items-center group">'))

const headerCode = fs.readFileSync(path.join(rootDir, 'src/components/layout/header.tsx'), 'utf-8')
assert('Header mobile drawer renders NexRepLogo with dark variant and tagline', headerCode.includes('<NexRepLogo variant="dark" showTagline={true} />'))

const welcomeModalCode = fs.readFileSync(path.join(rootDir, 'src/components/onboarding/welcome-modal.tsx'), 'utf-8')
assert('Welcome modal renders NexRepIcon', welcomeModalCode.includes('<NexRepIcon size={16} />'))
assert('Welcome modal text has "Welcome to NexRep by NexFlowOps"', welcomeModalCode.includes('Welcome to NexRep by NexFlowOps'))
assert('Welcome modal has no "SaaS" beside NexRep', !welcomeModalCode.includes('NexRep SaaS'))

const inviteCode = fs.readFileSync(path.join(rootDir, 'src/app/invite/[token]/page.tsx'), 'utf-8')
assert('Invite page renders NexRepLogo with light variant and tagline', inviteCode.includes('<NexRepLogo variant="light" showTagline={true} />'))

const loginCode = fs.readFileSync(path.join(rootDir, 'src/app/login/page.tsx'), 'utf-8')
assert('Login page renders NexRepLogo with light variant and tagline', loginCode.includes('<NexRepLogo variant="light" showTagline={true}'))
assert('Login page contains no generic blue star logo', !loginCode.includes('w-10 h-10 bg-blue-600 rounded-lg'))

const signupCode = fs.readFileSync(path.join(rootDir, 'src/app/signup/page.tsx'), 'utf-8')
assert('Signup page renders NexRepLogo with light variant and tagline', signupCode.includes('<NexRepLogo variant="light" showTagline={true}'))
assert('Signup page contains no generic blue star logo', !signupCode.includes('w-10 h-10 bg-blue-600 rounded-lg'))

const landingCode = fs.readFileSync(path.join(rootDir, 'src/app/page.tsx'), 'utf-8')
assert('Landing page header renders NexRepLogo with light variant and tagline', landingCode.includes('<NexRepLogo variant="light" showTagline={true} />'))
assert('Landing page contains no generic blue star logo', !landingCode.includes('w-8 h-8 bg-blue-600 rounded-lg'))

// Check across all files in src for any lingering "NexRep SaaS"
function checkNoNexRepSaaS(dir: string): boolean {
  let clean = true
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!checkNoNexRepSaaS(fullPath)) clean = false
    } else if (entry.isFile() && /\.(tsx|ts|js|jsx|json)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      if (content.toLowerCase().includes('nexrep saas')) {
        console.error(`Found "NexRep SaaS" in ${fullPath}`)
        clean = false
      }
    }
  }
  return clean
}

assert('Entire src/ tree contains zero occurrences of "NexRep SaaS"', checkNoNexRepSaaS(path.join(rootDir, 'src')))

// ---------------------------------------------------------------------------
// 3. Dashboard Full Business Name Display & LocationSelector Logic
// ---------------------------------------------------------------------------
console.log('\n--- 3. Dashboard Full Business Name Display & Selector Logic ---')

const selectorCode = fs.readFileSync(path.join(rootDir, 'src/components/location/location-selector.tsx'), 'utf-8')
assert('LocationSelectorProps defines optional truncateName boolean', selectorCode.includes('truncateName?: boolean'))
assert('LocationSelector defaults truncateName to true for backwards compatibility', selectorCode.includes('truncateName = true'))
assert('LocationSelector trigger button supports non-truncated dynamic height', selectorCode.includes('min-h-9 h-auto py-2 px-3'))
assert('LocationSelector button applies break-words whitespace-normal when !truncateName', selectorCode.includes('break-words whitespace-normal text-left leading-snug'))
assert('LocationSelector dropdown menu expands width when !truncateName', selectorCode.includes('w-80 sm:w-96 max-w-[90vw]'))
assert('LocationSelector dropdown item text wraps when !truncateName', selectorCode.includes('truncateName ? "truncate" : "break-words"'))

const dashboardCode = fs.readFileSync(path.join(rootDir, 'src/app/dashboard/page.tsx'), 'utf-8')
assert('Dashboard passes truncateName={false} to LocationSelector', dashboardCode.includes('truncateName={false}'))
assert('Dashboard LocationSelector has flexible responsive width', dashboardCode.includes('min-w-[220px] max-w-full sm:max-w-md lg:max-w-xl'))
assert('Dashboard subtitle text allows word breaking without truncation', dashboardCode.includes('break-words leading-relaxed'))
assert('Dashboard header container uses responsive flex-col md:flex-row layout', dashboardCode.includes('flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-1'))

// ---------------------------------------------------------------------------
// 4. Review Inbox Display Isolation
// ---------------------------------------------------------------------------
console.log('\n--- 4. Review Inbox Display Isolation ---')

const reviewsInboxCode = fs.readFileSync(path.join(rootDir, 'src/app/dashboard/reviews/page.tsx'), 'utf-8')
assert('Review Inbox LocationSelector retains compact w-[200px] class', reviewsInboxCode.includes('className="w-[200px]"'))
assert('Review Inbox does NOT pass truncateName={false} (retains default true)', !reviewsInboxCode.includes('truncateName={false}'))
assert('Review Inbox heading and layout preserved', reviewsInboxCode.includes('Reviews Inbox'))

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(80))
console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
console.log('='.repeat(80))

if (failed > 0) {
  process.exit(1)
} else {
  console.log('🎉 ALL BRANDING, BUSINESS NAME, AND ASSET VERIFICATION CHECKS PASSED!')
}
