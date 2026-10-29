import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  generateCustomerReviewSuggestion,
  generateMultiStyleReviewSuggestions,
  CustomerSuggestionTone,
} from '@/lib/customer-review-assistant'
import { checkRateLimit, getClientIpFromHeaders } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Rate limiting: 10 requests / minute (by user ID if logged in, or verified edge IP)
    const identifier = user?.id || `ip:${getClientIpFromHeaders(request.headers)}`
    const rateLimit = checkRateLimit(identifier, 10, 60 * 1000)
    if (!rateLimit.success) {
      const seconds = Math.ceil(rateLimit.resetMs / 1000)
      return NextResponse.json(
        {
          success: false,
          error: `Rate limit reached. Please wait ${seconds} seconds before generating another suggestion.`,
        },
        { status: 429 }
      )
    }

    const body = await request.json()
    const {
      businessName,
      rating,
      tags,
      experienceTags,
      serviceOrProduct,
      customerNotes,
      tone,
      multiStyle,
    } = body

    if (!businessName || typeof businessName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Business name is required.' },
        { status: 400 }
      )
    }

    const resolvedTags = Array.isArray(experienceTags)
      ? experienceTags.map(String)
      : Array.isArray(tags)
      ? tags.map(String)
      : []

    if (multiStyle || tone === 'all') {
      const multiResult = await generateMultiStyleReviewSuggestions({
        businessName: businessName.trim(),
        rating: rating ? Number(rating) : undefined,
        experienceTags: resolvedTags,
        serviceOrProduct: typeof serviceOrProduct === 'string' ? serviceOrProduct : undefined,
        customerNotes: typeof customerNotes === 'string' ? customerNotes : undefined,
      })

      if (!multiResult.success) {
        return NextResponse.json(multiResult, { status: 400 })
      }
      return NextResponse.json(multiResult)
    }

    const validTones: CustomerSuggestionTone[] = ['natural', 'detailed', 'concise', 'constructive']
    const selectedTone: CustomerSuggestionTone = validTones.includes(tone) ? tone : 'natural'

    const result = await generateCustomerReviewSuggestion({
      businessName: businessName.trim(),
      rating: rating ? Number(rating) : undefined,
      experienceTags: resolvedTags,
      serviceOrProduct: typeof serviceOrProduct === 'string' ? serviceOrProduct : undefined,
      customerNotes: typeof customerNotes === 'string' ? customerNotes : undefined,
      tone: selectedTone,
    })

    if (!result.success) {
      return NextResponse.json(result, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
