import { config } from 'dotenv'
config({ path: '.env.local' })

import { generateReviewReply } from '../src/lib/ai'

async function runRealOpenAiTest() {
  console.log('='.repeat(70))
  console.log('NexRep Real OpenAI API Integration Test')
  console.log('='.repeat(70))

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (!apiKey || apiKey.trim() === '') {
    console.error('❌ Error: OPENAI_API_KEY is not set in .env.local.')
    process.exit(1)
  }

  console.log(`✅ Loaded OPENAI_API_KEY (Length: ${apiKey.length} chars, Prefix: ${apiKey.slice(0, 7)}...)`)
  console.log(`✅ Target Model: ${model}`)
  console.log('🔒 Google Publishing APIs: Strictly Disabled (0 calls)')

  const sampleReview = {
    authorName: 'Sarah Jenkins (Sample Verification Review)',
    rating: 5,
    reviewContent: 'The customer service was exceptional! The staff went above and beyond to help me with my order. Highly recommend!',
    tone: 'friendly' as const,
    businessName: 'NexRep Demo Boutique',
    locationName: 'Downtown Store',
  }

  console.log('\nSubmitting Sample Review to OpenAI:')
  console.log(`- Author: ${sampleReview.authorName}`)
  console.log(`- Rating: ${sampleReview.rating} / 5 stars`)
  console.log(`- Review: "${sampleReview.reviewContent}"`)
  console.log(`- Tone: ${sampleReview.tone}`)
  console.log(`- Business: ${sampleReview.businessName}`)

  console.log('\n⏳ Calling OpenAI API (https://api.openai.com/v1/chat/completions)...')
  const startTime = Date.now()

  const result = await generateReviewReply(sampleReview)
  const durationMs = Date.now() - startTime

  console.log('\n' + '='.repeat(70))
  console.log('OPENAI API RESPONSE EVALUATION:')
  console.log('='.repeat(70))
  console.log(`Elapsed Time: ${durationMs}ms`)
  console.log(`Success: ${result.success}`)
  console.log(`Fallback Generator Used: ${Boolean(result.fallbackUsed)}`)

  if (result.fallbackUsed) {
    console.log('\n⚠️ ATTENTION: The response was produced by the LOCAL OFFLINE FALLBACK GENERATOR.')
    if (result.error) {
      console.log(`OpenAI API Error: ${result.error}`)
    }
  } else {
    console.log('\n🎉 SUCCESS: The response was generated dynamically by REAL OPENAI API!')
    console.log(`Model: ${model}`)
  }

  console.log('\nGenerated Reply Text:')
  console.log('-'.repeat(70))
  console.log(result.reply)
  console.log('-'.repeat(70))

  if (!result.fallbackUsed && result.success) {
    console.log('\n✅ Verification Result: REAL_OPENAI_ACTIVE')
    process.exit(0)
  } else {
    console.log('\n⚠️ Verification Result: FALLBACK_USED')
    process.exit(1)
  }
}

runRealOpenAiTest().catch((err) => {
  console.error('Fatal execution error:', err.message)
  process.exit(1)
})
