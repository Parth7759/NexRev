export type CustomerSuggestionTone = 'natural' | 'detailed' | 'concise' | 'constructive'

export interface CustomerReviewInput {
  businessName: string
  rating?: number
  experienceTags?: string[]
  serviceOrProduct?: string
  customerNotes?: string
  tone?: CustomerSuggestionTone
}

export interface CustomerReviewResult {
  success: boolean
  draftReview?: string
  disclaimer: string
  error?: string
}

const DEFAULT_DISCLAIMER =
  'This suggestion is generated to help you describe your authentic experience. All text is fully editable and optional. Please personalize it before posting to ensure it accurately reflects your real visit.'

/**
 * Customer Review Assistant Service.
 * Helps real customers articulate their genuine experiences into clear, respectful review text.
 * Strictly enforces ethical guidelines against fake reviews, review gating, or forced positive bias.
 */
export async function generateCustomerReviewSuggestion(
  input: CustomerReviewInput
): Promise<CustomerReviewResult> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey || apiKey.trim() === '') {
    return {
      success: false,
      disclaimer: DEFAULT_DISCLAIMER,
      error: 'OPENAI_API_KEY is not configured on the server.',
    }
  }

  const businessName = input.businessName?.trim() || 'this business'
  const rating = input.rating ? Math.max(1, Math.min(5, Math.round(input.rating))) : undefined
  const tags = Array.isArray(input.experienceTags) ? input.experienceTags.filter(Boolean) : []
  const customerNotes = input.customerNotes?.trim() || ''

  if (tags.length === 0 && customerNotes.length < 3) {
    return {
      success: false,
      disclaimer: DEFAULT_DISCLAIMER,
      error: 'Please select at least one experience highlight or enter brief notes about your visit.',
    }
  }

  const tone = input.tone || (rating && rating <= 3 ? 'constructive' : 'natural')

  const systemPrompt = `You are an ethical, helpful customer review writing assistant for a consumer visiting "${businessName}".
Your sole objective is to help the customer put their genuine, firsthand thoughts into clear, natural words.

STRICT ETHICAL & COMPLIANCE RULES:
1. NEVER fabricate facts, visits, staff names, or events not provided by the customer.
2. NEVER pressure, manipulate, or coerce the customer to give a positive rating or 5 stars.
3. If the customer indicated a critical, mixed, or negative experience (1-3 stars), assist them in expressing constructive, factual, and polite feedback without aggression.
4. Reflect ONLY the highlights and notes provided by the customer.
5. Write in the first-person voice of the customer ("I visited...", "My experience was...").
6. Provide ONLY the draft review text. Do not include quotes, conversational preamble, or markdown formatting.`

  const userPrompt = `Business Name: ${businessName}
${rating ? `Rating: ${rating} out of 5 stars` : 'Rating: Customer has not specified a numerical rating'}
${input.serviceOrProduct ? `Service / Product: ${input.serviceOrProduct}` : ''}
${tags.length > 0 ? `Highlights / Points mentioned by customer: ${tags.join(', ')}` : ''}
${customerNotes ? `Customer's Personal Notes: "${customerNotes}"` : ''}
Tone Preference: ${tone}

Compose a genuine, natural 2-4 sentence review draft based strictly on the above details.`

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 250,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      if (response.status === 429) {
        return {
          success: false,
          disclaimer: DEFAULT_DISCLAIMER,
          error: 'Review assistant quota exceeded. Please try again in a few moments.',
        }
      }
      return {
        success: false,
        disclaimer: DEFAULT_DISCLAIMER,
        error: `AI provider error (status ${response.status}). Please write your feedback directly.`,
      }
    }

    const data = await response.json()
    const draft = data.choices?.[0]?.message?.content?.trim()

    if (!draft) {
      return {
        success: false,
        disclaimer: DEFAULT_DISCLAIMER,
        error: 'The review assistant could not generate a draft. Please enter your feedback directly.',
      }
    }

    return {
      success: true,
      draftReview: draft,
      disclaimer: DEFAULT_DISCLAIMER,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Connection failed'
    return {
      success: false,
      disclaimer: DEFAULT_DISCLAIMER,
      error: `Could not generate review draft: ${msg}`,
    }
  }
}

export interface MultiStyleSuggestionsResult {
  success: boolean
  suggestions?: {
    short: string
    detailed: string
    natural: string
  }
  disclaimer: string
  error?: string
}

/**
 * Generates customer review suggestions in 3 distinct genuine styles:
 * 1. Short (1-2 sentences)
 * 2. Detailed (richer context)
 * 3. Natural (casual everyday phrasing)
 * Respects customer sentiment (never forces positive or gates negative feedback).
 */
export async function generateMultiStyleReviewSuggestions(
  input: Omit<CustomerReviewInput, 'tone'>
): Promise<MultiStyleSuggestionsResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const businessName = input.businessName?.trim() || 'this business'
  const rating = input.rating ? Math.max(1, Math.min(5, Math.round(input.rating))) : undefined
  const tags = Array.isArray(input.experienceTags) ? input.experienceTags.filter(Boolean) : []
  const customerNotes = input.customerNotes?.trim() || ''

  if (tags.length === 0 && customerNotes.length < 2) {
    return {
      success: false,
      disclaimer: DEFAULT_DISCLAIMER,
      error: 'Please select at least one highlight or enter brief notes about your visit.',
    }
  }

  // Synthesize rule-based authentic drafts if no API key is provided
  if (!apiKey || apiKey.trim() === '') {
    const isCritical = rating !== undefined && rating <= 3
    const tagList = tags.join(', ')

    const shortDraft = isCritical
      ? `Visited ${businessName}. ${customerNotes || tagList || 'Encountered some issues that need attention.'}`
      : `Great experience with ${businessName}. ${tagList ? `Really appreciated the ${tagList.toLowerCase()}.` : ''} ${customerNotes}`.trim()

    const detailedDraft = isCritical
      ? `I wanted to share my honest feedback regarding ${businessName}. While I appreciate the effort, ${customerNotes || `we experienced shortcomings with ${tagList.toLowerCase() || 'service'}`}. I hope management addresses this constructively.`
      : `I had a positive visit to ${businessName}. ${tagList ? `The ${tagList.toLowerCase()} stood out in particular.` : ''} ${customerNotes ? `Specifically: ${customerNotes}.` : ''} Thank you for the attentive service.`.trim()

    const naturalDraft = isCritical
      ? `Just stopped by ${businessName}. ${customerNotes || `The ${tagList.toLowerCase() || 'experience'} was not quite what I expected`}. Could definitely use some improvement.`
      : `Stopped by ${businessName} recently and had a great time. ${tagList ? `Loved the ${tagList.toLowerCase()}.` : ''} ${customerNotes}`.trim()

    return {
      success: true,
      suggestions: {
        short: shortDraft,
        detailed: detailedDraft,
        natural: naturalDraft,
      },
      disclaimer: DEFAULT_DISCLAIMER,
    }
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const systemPrompt = `You are an ethical, compliant customer review writing assistant for a consumer visiting "${businessName}".
Your role is to help the customer articulate their genuine, firsthand experience in 3 different styles.

STRICT ETHICAL & COMPLIANCE RULES:
1. NEVER fabricate facts, visits, employee names, or claims not provided by the customer.
2. NEVER pressure or coerce the customer to give positive ratings or 5 stars.
3. If the customer indicated a critical/mixed rating (1-3 stars), provide constructive, polite feedback focusing honestly on what happened.
4. Return ONLY a valid JSON object with exactly three keys: "short", "detailed", and "natural".
   - "short": 1-2 concise, punchy sentences.
   - "detailed": A complete, balanced 3-4 sentence paragraph touching on their specific remarks.
   - "natural": A relaxed, friendly, everyday conversational review.
5. Do not include markdown code block syntax (like \`\`\`json). Output pure JSON.`

  const userPrompt = `Business: ${businessName}
${rating ? `Rating: ${rating} out of 5 stars` : 'Rating: Not specified'}
${input.serviceOrProduct ? `Service / Product: ${input.serviceOrProduct}` : ''}
${tags.length > 0 ? `Highlights / Selected Tags: ${tags.join(', ')}` : ''}
${customerNotes ? `Customer Notes: "${customerNotes}"` : ''}

Generate the 3 review styles now in JSON format: {"short": "...", "detailed": "...", "natural": "..."}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 450,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      // Fall back cleanly if OpenAI quota or error occurs
      return generateMultiStyleReviewSuggestions({ ...input, businessName })
    }

    const data = await response.json()
    const rawContent = data.choices?.[0]?.message?.content?.trim() || ''

    try {
      const cleanJson = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
      const parsed = JSON.parse(cleanJson)
      if (parsed.short && parsed.detailed && parsed.natural) {
        return {
          success: true,
          suggestions: {
            short: String(parsed.short).trim(),
            detailed: String(parsed.detailed).trim(),
            natural: String(parsed.natural).trim(),
          },
          disclaimer: DEFAULT_DISCLAIMER,
        }
      }
    } catch {
      // Fallback to rule-based drafts if JSON parsing failed
    }

    // Default fallback
    return {
      success: true,
      suggestions: {
        short: `Had a visit at ${businessName}. ${customerNotes || tags.join(', ')}`.trim(),
        detailed: `I recently visited ${businessName}. ${tags.length > 0 ? `Appreciated the ${tags.join(', ').toLowerCase()}.` : ''} ${customerNotes ? `Specifically: ${customerNotes}.` : ''}`.trim(),
        natural: `Just visited ${businessName}. ${customerNotes || tags.join(', ')}`.trim(),
      },
      disclaimer: DEFAULT_DISCLAIMER,
    }
  } catch {
    return {
      success: true,
      suggestions: {
        short: `Had a visit at ${businessName}. ${customerNotes || tags.join(', ')}`.trim(),
        detailed: `I recently visited ${businessName}. ${tags.length > 0 ? `Appreciated the ${tags.join(', ').toLowerCase()}.` : ''} ${customerNotes ? `Specifically: ${customerNotes}.` : ''}`.trim(),
        natural: `Just visited ${businessName}. ${customerNotes || tags.join(', ')}`.trim(),
      },
      disclaimer: DEFAULT_DISCLAIMER,
    }
  }
}

