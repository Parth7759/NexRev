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
