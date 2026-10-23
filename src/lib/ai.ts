export type ReplyTone = 'professional' | 'friendly' | 'concise' | 'empathetic'

export interface GenerateReplyInput {
  authorName?: string
  rating: number
  reviewContent?: string | null
  locationName?: string
  businessName?: string
  tone: ReplyTone
}

export interface GenerateReplyResult {
  success: boolean
  reply?: string
  error?: string
  fallbackUsed?: boolean
}

/**
 * Detects the predominant language of the review text to support language matching.
 */
function detectReviewLanguage(text: string): 'es' | 'fr' | 'de' | 'hi' | 'en' {
  const lower = text.toLowerCase()

  // Devanagari script or distinct Hindi / Hinglish terms
  if (
    /[\u0900-\u097F]/.test(text) ||
    /\b(bahut|accha|achha|bura|dhanyawad|dhanyavad|kripya|ganda|shandar|swad|kharab|shukriya|namaste|hume|humari|aapka|aapke)\b/.test(lower)
  ) {
    return 'hi'
  }

  // Count core English stopwords to prevent false positives from loanwords like 'service'
  const englishWordCount = (lower.match(/\b(the|and|was|were|is|are|had|have|has|for|with|this|that|very|our|you|your|not|from|out|all|we)\b/g) || []).length

  // Spanish keywords (when not primarily English)
  if (
    englishWordCount < 2 &&
    /\b(gracias|servicio|excelente|muy|bueno|buena|malo|mala|comida|atención|atencion|espera|pésimo|pesimo|lugar|volveré|volvere|horrible|nada)\b/.test(lower)
  ) {
    return 'es'
  }

  // German keywords (when not primarily English)
  if (
    englishWordCount < 2 &&
    /\b(danke|vielen dank|sehr|schlecht|essen|warten|unfreundlich|wieder|qualität|empfehlen|freundlicher|tolle)\b/.test(lower)
  ) {
    return 'de'
  }

  // French keywords (avoid 'service' which is identical in English)
  if (
    englishWordCount < 2 &&
    /\b(merci|très|tres|mauvais|accueil|attente|délicieux|delicieux|recommande|équipe|equipe|parfait|nous|vous|votre)\b/.test(lower)
  ) {
    return 'fr'
  }

  return 'en'
}

/**
 * Intelligent rule-based reply generator adhering strictly to all rating and safety rules.
 * Acts as an offline fallback when OpenAI quota is exhausted or network is unavailable,
 * guaranteeing that AI replies are NEVER blocked for any rating.
 */
export function generateRuleBasedReply(input: GenerateReplyInput): string {
  const author = input.authorName?.trim() || ''
  const rating = Math.max(1, Math.min(5, Math.round(input.rating || 5)))
  const content = (input.reviewContent || '').trim()
  const lowerContent = content.toLowerCase()
  const business = input.businessName?.trim() || 'our business'
  const lang = detectReviewLanguage(content)

  // Language: SPANISH
  if (lang === 'es') {
    const greeting = author ? `Hola ${author}, ` : 'Hola, '
    if (rating === 1) {
      return `${greeting}lamentamos sinceramente su mala experiencia. Agradecemos que nos haya señalado este problema y nos disculpamos por no haber cumplido con sus expectativas. Por favor contáctenos directamente para poder revisar su caso y ofrecerle una solución adecuada.`
    }
    if (rating === 2) {
      return `${greeting}gracias por compartir sus comentarios. Lamentamos los inconvenientes que experimentó y tomamos muy en serio lo sucedido para corregirlo y mejorar nuestro servicio.`
    }
    if (rating === 3) {
      return `${greeting}apreciamos su reseña equilibrada. Nos alegra conocer los aspectos positivos que destaca, y ya estamos revisando los puntos a mejorar para brindarle una mejor experiencia en su próxima visita.`
    }
    if (rating === 4) {
      return `${greeting}¡muchas gracias por su reseña de 4 estrellas! Nos complace saber que tuvo una experiencia positiva con nosotros y tomamos nota de sus sugerencias para seguir mejorando.`
    }
    return `${greeting}¡muchísimas gracias por su excelente valoración de 5 estrellas! Nos alegra profundamente saber que disfrutó de su experiencia con nosotros. ¡Esperamos verle pronto de nuevo!`
  }

  // Language: FRENCH
  if (lang === 'fr') {
    const greeting = author ? `Bonjour ${author}, ` : 'Bonjour, '
    if (rating === 1) {
      return `${greeting}nous sommes sincèrement désolés pour votre expérience insatisfaisante. Vos remarques sont précieuses et nous vous présentons toutes nos excuses. N'hésitez pas à contacter directement notre équipe afin que nous puissions trouver une solution adaptée.`
    }
    if (rating === 2) {
      return `${greeting}merci d'avoir pris le temps de nous écrire. Nous regrettons sincèrement les désagréments rencontrés et nous prenons des mesures immédiates avec notre équipe pour y remédier.`
    }
    if (rating === 3) {
      return `${greeting}merci pour votre retour constructif. Nous sommes heureux des points positifs relevés et nous prenons note de vos remarques afin d'améliorer votre prochaine visite.`
    }
    if (rating === 4) {
      return `${greeting}merci beaucoup pour votre avis 4 étoiles ! Nous sommes ravis que vous ayez apprécié notre service et prenons note de vos suggestions pour continuer à progresser.`
    }
    return `${greeting}un grand merci pour votre note de 5 étoiles ! Toute notre équipe est ravie que vous ayez passé un si bon moment parmi nous. Au grand plaisir de vous accueillir à nouveau !`
  }

  // Language: GERMAN
  if (lang === 'de') {
    const greeting = author ? `Hallo ${author}, ` : 'Hallo, '
    if (rating === 1) {
      return `${greeting}wir bedauern Ihre enttäuschende Erfahrung sehr und entschuldigen uns aufrichtig dafür. Bitte wenden Sie sich direkt an unser Management-Team, damit wir Ihr Anliegen persönlich und schnell klären können.`
    }
    if (rating === 2) {
      return `${greeting}vielen Dank für Ihr ehrliches Feedback. Es tut uns leid, dass Ihr Besuch nicht unseren Standards entsprochen hat. Wir besprechen Ihre Hinweise intern, um unseren Service zu verbessern.`
    }
    if (rating === 3) {
      return `${greeting}vielen Dank für Ihre ausgewogene Rückmeldung. Wir freuen uns über die positiven Punkte und nehmen Ihre Verbesserungsvorschläge sehr ernst, um Ihnen beim nächsten Mal ein noch besseres Erlebnis zu bieten.`
    }
    if (rating === 4) {
      return `${greeting}herzlichen Dank für die 4-Sterne-Bewertung! Es freut uns sehr, dass Sie zufrieden waren, und wir arbeiten weiter daran, Ihren nächsten Besuch zu einem 5-Sterne-Erlebnis zu machen.`
    }
    return `${greeting}vielen herzlichen Dank für Ihre wunderbare 5-Sterne-Bewertung! Wir freuen uns sehr über Ihr Lob und darauf, Sie bald wieder bei uns begrüßen zu dürfen!`
  }

  // Language: HINDI / HINGLISH
  if (lang === 'hi') {
    const greeting = author ? `Namaste ${author}, ` : 'Namaste, '
    if (rating === 1) {
      return `${greeting}aapke asuvidhaajanak anubhav ke liye hume khed hai. Kripya humari management team se seedhe sampark karein taaki hum is samasya ka uchit samadhaan nikaal sakein.`
    }
    if (rating === 2) {
      return `${greeting}aapke feedback ke liye dhanyawad. Hum apni sevaon ko behtar banane ke liye aapke sujhavo par dhyan denge.`
    }
    if (rating === 3) {
      return `${greeting}aapke santulit feedback ke liye dhanyawad. Hum aasha karte hain ki agali baar aapko aur behtar anubhav milega.`
    }
    if (rating === 4) {
      return `${greeting}4-star review ke liye bahut-bahut dhanyawad! Hum aapke sujhavo par kaam karte hue aage aur behtar pradarshan karenge.`
    }
    return `${greeting}5-star review aur prashansa ke liye aapka bohot-bohot dhanyawad! Hum aapse dobara milne ke liye utsuk hain.`
  }

  // Language: ENGLISH (Default)
  const greeting = author ? `Hi ${author}, ` : 'Hello, '

  // Extract specific complaint/praise topic if available
  let complaintTopic = 'your recent experience'
  if (/wait|delayed|slow|timing|hour|minute/.test(lowerContent)) {
    complaintTopic = 'the wait time and delay you experienced'
  } else if (/staff|rude|attitude|behavior|customer service/.test(lowerContent)) {
    complaintTopic = 'the customer service shortcomings you encountered'
  } else if (/quality|product|food|item|broken|defective/.test(lowerContent)) {
    complaintTopic = 'the quality issues you described'
  } else if (/clean|dirty|hygiene|mess/.test(lowerContent)) {
    complaintTopic = 'the cleanliness concerns you observed'
  } else if (/price|expensive|cost|overpriced|charge/.test(lowerContent)) {
    complaintTopic = 'the pricing concerns you mentioned'
  }

  let positiveTopic = 'our service'
  if (/friendly|helpful|kind|staff|team/.test(lowerContent)) {
    positiveTopic = 'our friendly team and customer support'
  } else if (/fast|quick|prompt|efficient/.test(lowerContent)) {
    positiveTopic = 'the prompt and efficient service'
  } else if (/clean|beautiful|ambiance|atmosphere/.test(lowerContent)) {
    positiveTopic = 'the welcoming atmosphere and clean space'
  } else if (/quality|great|awesome|delicious|amazing/.test(lowerContent)) {
    positiveTopic = 'the high quality of what we delivered'
  }

  // Tone-specific nuances
  const isConcise = input.tone === 'concise'
  const isEmpathetic = input.tone === 'empathetic'
  const isFriendly = input.tone === 'friendly'

  // Rating 1: Acknowledge specific complaint, apologize empathetically, offer professional resolution path
  if (rating === 1) {
    if (isConcise) {
      return `${greeting}we sincerely apologize for ${complaintTopic}. Please reach out directly to our management team so we can address this with you.`
    }
    if (isEmpathetic) {
      return `${greeting}we are deeply sorry to hear about ${complaintTopic}. We completely understand your frustration and regret that we let you down. We would truly appreciate the opportunity to make this right—please contact our management team directly so we can personally assist you.`
    }
    return `${greeting}thank you for bringing this to our attention. We sincerely apologize for ${complaintTopic}, as this does not reflect the standard of service we strive to deliver. Please reach out to our management team directly so we can look into what happened and work toward a resolution.`
  }

  // Rating 2: Address actual negative feedback, acknowledge what went wrong, commitment to improve
  if (rating === 2) {
    if (isConcise) {
      return `${greeting}thank you for your feedback regarding ${complaintTopic}. We apologize that things fell short and are actively addressing this with our team.`
    }
    return `${greeting}thank you for sharing your candid feedback with us. We are sorry that your experience fell short of expectations regarding ${complaintTopic}. We take your comments seriously and are reviewing this with our team to ensure we improve our service going forward.`
  }

  // Rating 3: Recognize both positive and negative points, respond constructively
  if (rating === 3) {
    if (isConcise) {
      return `${greeting}thank you for your balanced review. We appreciate your positive remarks and are addressing your concerns regarding ${complaintTopic} to do better next time.`
    }
    return `${greeting}thank you for taking the time to leave a balanced review. We are glad you appreciated ${positiveTopic}, but we also acknowledge your feedback regarding ${complaintTopic}. We are using your notes constructively to improve and hope to welcome you back for a seamless visit.`
  }

  // Rating 4: Thank customer, acknowledge specific positive feedback and any suggestions
  if (rating === 4) {
    if (isConcise) {
      return `${greeting}thank you for the 4-star review! We are glad you enjoyed ${positiveTopic} and have noted your suggestions for continuous improvement.`
    }
    if (isFriendly) {
      return `${greeting}thank you so much for the 4-star rating! We are so happy to hear you had a great experience with ${positiveTopic}. We really appreciate your suggestions and look forward to earning that 5th star on your next visit!`
    }
    return `${greeting}thank you for taking the time to leave us a 4-star review. We are delighted to hear you had a positive experience with ${positiveTopic}. We value your helpful feedback and look forward to serving you again soon.`
  }

  // Rating 5: Thank customer, personalize using details from review
  if (isConcise) {
    return `${greeting}thank you for the fantastic 5-star review! We are thrilled you enjoyed ${positiveTopic} and truly appreciate your support.`
  }
  if (isFriendly) {
    return `${greeting}thank you so much for the glowing 5-star review! It made our day to hear how much you loved ${positiveTopic}. We are truly grateful for your support of ${business} and cannot wait to welcome you back!`
  }
  return `${greeting}thank you so much for taking the time to share your 5-star experience with us. We are thrilled to hear your kind words about ${positiveTopic}. Your feedback means a great deal to our entire team at ${business}, and we look forward to seeing you again soon!`
}

/**
 * Server-side AI Reply Generation Service.
 * Uses OPENAI_API_KEY from server environment variables when available,
 * and seamlessly provides intelligent rule-based generation when the external provider
 * quota is exhausted or offline.
 *
 * Enforces mandatory behavior:
 * - Generates a personalized reply for EVERY rating (1, 2, 3, 4, 5).
 * - Never skips or blocks replies for low ratings.
 * - Adheres strictly to review-specific rules, factual safety, language matching, and tone.
 */
export async function generateReviewReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
  const rating = Math.max(1, Math.min(5, Math.round(input.rating || 5)))
  const reviewContent = (input.reviewContent || '').trim()

  const validTones: ReplyTone[] = ['professional', 'friendly', 'concise', 'empathetic']
  const tone = validTones.includes(input.tone) ? input.tone : 'professional'

  const toneInstructions: Record<ReplyTone, string> = {
    professional: 'Maintain a polished, respectful, and courteous tone. Thank the customer for their patronage and feedback.',
    friendly: 'Adopt a warm, welcoming, and cheerful tone with personal warmth and enthusiasm.',
    concise: 'Keep the response extremely brief, direct, and focused in 1-2 clear sentences. Do not use filler words.',
    empathetic: 'Demonstrate deep compassion, attentiveness, and understanding. Acknowledge any shortcomings gently and express sincere desire to assist or resolve concerns.',
  }

  const ratingSpecificGuidance: Record<number, string> = {
    1: '1-STAR REVIEW RULES:\n- Acknowledge the customer\'s specific complaint empathetically.\n- Apologize sincerely and gracefully where appropriate without being defensive.\n- Offer a clear, professional path to resolve the issue offline (e.g., invite them to contact management directly).\n- Never invent facts, never blame the customer, never claim the issue has already been resolved, and never make excuses.',
    2: '2-STAR REVIEW RULES:\n- Address the actual negative feedback mentioned in the review.\n- Directly acknowledge what went wrong and express regret for their unsatisfactory experience.\n- Explain our dedication to high standards and improving the customer experience.',
    3: '3-STAR REVIEW RULES:\n- Recognize both the positive aspects and the negative/critical points mentioned in the review.\n- Respond constructively, showing appreciation for their balanced and honest perspective.\n- Address their concerns while welcoming them back.',
    4: '4-STAR REVIEW RULES:\n- Thank the customer warmly for their positive review and patronage.\n- Acknowledge their specific positive feedback and any helpful suggestions or minor critiques they mentioned.\n- Invite them to visit or work with us again soon.',
    5: '5-STAR REVIEW RULES:\n- Enthusiastically thank the customer for the glowing 5-star rating.\n- Personalize the response by explicitly referencing specific details, products, staff, or services highlighted in their review.\n- Express genuine gratitude and excitement to welcome them back.',
  }

  const systemPrompt = `You are a professional reputation management assistant for "${input.businessName || 'our business'}".
Your job is to compose a thoughtful, natural public reply to a customer review on Google Business Profile.

Tone: ${tone.toUpperCase()} - ${toneInstructions[tone]}

${ratingSpecificGuidance[rating]}

MANDATORY RULES FOR ALL REPLIES:
1. READ THE REVIEW & RATING: Carefully read the actual review text and rating (${rating} out of 5 stars) before composing the response.
2. PERSONALIZED, NOT GENERIC: Tailor the reply to the exact details mentioned. Never use the same canned response for multiple reviews.
3. FACTUAL INTEGRITY & SAFETY:
   - Never invent facts, policies, or past interactions.
   - Never offer or promise monetary compensation, refunds, discounts, or free gifts.
   - Never claim an issue has already been fixed or resolved.
   - Never blame the customer or argue with their perspective.
4. LANGUAGE MATCHING: Detect and match the language of the customer's review (e.g. if the review is in Spanish, reply in Spanish; if in French, reply in French; if in German, reply in German; if in Hindi/Hinglish, reply in Hindi/Hinglish; default to English if English or indeterminate).
5. NATURAL, PROFESSIONAL & CONCISE: Keep replies natural, professional, concise, and specific to the customer's feedback (typically 2-4 sentences). Avoid corporate jargon or excessive filler.
6. OUTPUT FORMAT: Output ONLY the final reply text. Do NOT include placeholders like "[Your Name]", "[Phone Number]", "[Email]", or quotation marks around the response.`

  const userMessage = `Customer Name: ${input.authorName || 'Valued Customer'}
Rating: ${rating} / 5 stars
${input.locationName ? `Location: ${input.locationName}` : ''}
Review Content:
"""
${reviewContent || '(Star rating provided without written comment)'}
"""`

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  // If no OpenAI key is configured, provide the rule-based response so reply generation is never blocked
  if (!apiKey || apiKey.trim() === '') {
    const fallbackReply = generateRuleBasedReply(input)
    return {
      success: true,
      reply: fallbackReply,
      fallbackUsed: true,
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

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
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 350,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      // If OpenAI reports 429 quota/rate limit or 401 auth failure, seamlessly use the intelligent rule-based generator
      // so review reply generation is never blocked for any customer review.
      if (response.status === 429 || response.status === 401) {
        const fallbackReply = generateRuleBasedReply(input)
        return {
          success: true,
          reply: fallbackReply,
          fallbackUsed: true,
        }
      }

      let errorBody: { error?: { message?: string } } = {}
      try {
        errorBody = await response.json()
      } catch {
        // Fallback for non-JSON error
      }

      const serverError = errorBody.error?.message || `OpenAI request failed with status ${response.status}`
      // Fallback on error so user workflow is not halted
      const fallbackReply = generateRuleBasedReply(input)
      return {
        success: true,
        reply: fallbackReply,
        fallbackUsed: true,
        error: serverError,
      }
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content?.trim()

    if (!reply) {
      const fallbackReply = generateRuleBasedReply(input)
      return {
        success: true,
        reply: fallbackReply,
        fallbackUsed: true,
      }
    }

    return {
      success: true,
      reply,
    }
  } catch {
    // If request times out or network is unavailable, provide the rule-based generation
    const fallbackReply = generateRuleBasedReply(input)
    return {
      success: true,
      reply: fallbackReply,
      fallbackUsed: true,
    }
  }
}
