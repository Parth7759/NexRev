import { config } from 'dotenv'
config({ path: '.env.local' })

import { generateReviewReply } from '../src/lib/ai'

async function runContextAwareOpenAiTest() {
  console.log('='.repeat(75))
  console.log('NexRep Live Context-Aware AI Generation Test (OpenAI gpt-4o-mini)')
  console.log('='.repeat(75))
  console.log('🔒 Safety: No Google publishing APIs called. Zero real customer data.')

  const mockReviews = [
    {
      name: 'Mixed Sentiment (3-Star)',
      input: {
        authorName: 'Michael Chang',
        rating: 3,
        reviewContent: 'The truffle pasta was incredible and full of flavor, but we waited 45 minutes for a table even with a reservation and our server was inattentive.',
        tone: 'professional' as const,
        businessName: 'Trattoria Bella',
        locationName: 'North Beach',
        businessContext: 'Authentic handmade Italian pasta shop specializing in northern Italian recipes',
      },
    },
    {
      name: 'Empty Review Text (4-Star Rating Only)',
      input: {
        authorName: 'Emma Watson',
        rating: 4,
        reviewContent: '',
        tone: 'friendly' as const,
        businessName: 'Trattoria Bella',
        locationName: 'North Beach',
        businessContext: 'Authentic handmade Italian pasta shop specializing in northern Italian recipes',
      },
    },
    {
      name: 'Serious Negative Complaint (1-Star)',
      input: {
        authorName: 'Robert Vance',
        rating: 1,
        reviewContent: 'We found a piece of sharp plastic in our soup and the floor manager dismissed our concern completely and refused to take it off the bill.',
        tone: 'empathetic' as const,
        businessName: 'Trattoria Bella',
        locationName: 'North Beach',
        businessContext: 'Authentic handmade Italian pasta shop specializing in northern Italian recipes',
      },
    },
  ]

  for (const t of mockReviews) {
    console.log('\n' + '-'.repeat(75))
    console.log(`TEST CASE: ${t.name}`)
    console.log(`- Author: ${t.input.authorName}`)
    console.log(`- Rating: ${t.input.rating} stars`)
    console.log(`- Review: "${t.input.reviewContent || '(Empty star rating)'}"`)
    console.log(`- Tone: ${t.input.tone}`)

    const start = Date.now()
    const res = await generateReviewReply(t.input)
    const elapsed = Date.now() - start

    console.log(`\nResult (Elapsed: ${elapsed}ms | Fallback Used: ${Boolean(res.fallbackUsed)}):`)
    console.log(`Reply: "${res.reply}"`)

    if (t.input.reviewContent === '') {
      // Must not hallucinate truffle pasta or dishes
      if (/pasta|soup|truffle|server|wait/i.test(res.reply || '')) {
        console.error('❌ Warning: Empty review hallucinated specific items!')
      } else {
        console.log('✅ Empty review cleanly addressed rating without inventing details.')
      }
    }

    if (t.input.rating === 3) {
      if (/pasta|flavor/i.test(res.reply || '') && /wait|delay|reserv|table|attentive/i.test(res.reply || '')) {
        console.log('✅ Mixed review addressed both positive praise and negative critique.')
      }
    }

    if (t.input.rating === 1) {
      if (/apolog|sorry/i.test(res.reply || '') && /reach out|contact|management/i.test(res.reply || '')) {
        console.log('✅ 1-Star complaint included sincere apology and offline resolution next step.')
      }
      if (/refunded your|free meal|50% off|fired the/i.test(res.reply || '')) {
        console.error('❌ Warning: Fabricated promise or refund detected!')
      } else {
        console.log('✅ Factual integrity preserved (no fake refunds or HR claims).')
      }
    }
  }

  console.log('\n' + '='.repeat(75))
  console.log('✅ All live OpenAI context-aware tests completed successfully!')
  console.log('='.repeat(75))
}

runContextAwareOpenAiTest().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
