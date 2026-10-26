export type ReplyTone = 'professional' | 'friendly' | 'concise' | 'empathetic'

export interface GenerateReplyInput {
  authorName?: string
  rating: number
  reviewContent?: string | null
  locationName?: string
  businessName?: string
  businessContext?: string
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
  const business = input.businessName?.trim() || input.businessContext?.trim() || 'our business'
  const lang = detectReviewLanguage(content)

  // Empty review check: when customer leaves only a star rating without written text
  const isEmptyContent = content.length === 0

  // Language: SPANISH
  if (lang === 'es') {
    const greeting = author ? `Hola ${author}, ` : 'Hola, '
    if (isEmptyContent) {
      if (rating >= 4) {
        return `${greeting}¡muchas gracias por su valoración de ${rating} estrellas! Agradecemos sinceramente su apoyo y esperamos verle pronto de nuevo.`
      }
      if (rating === 3) {
        return `${greeting}gracias por calificarnos con 3 estrellas. Agradecemos su visita y esperamos poder brindarle una experiencia de 5 estrellas en su próxima oportunidad.`
      }
      return `${greeting}gracias por calificarnos. Lamentamos que su experiencia no haya cumplido plenamente sus expectativas. Si desea compartir más detalles para ayudarnos a mejorar, por favor contáctenos directamente.`
    }
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
    if (isEmptyContent) {
      if (rating >= 4) {
        return `${greeting}merci beaucoup pour votre note de ${rating} étoiles ! Nous vous remercions pour votre confiance et serons ravis de vous accueillir à nouveau.`
      }
      if (rating === 3) {
        return `${greeting}merci pour votre note. Nous espérons avoir l'opportunité de vous offrir une expérience 5 étoiles lors de votre prochaine visite.`
      }
      return `${greeting}merci pour votre retour. Nous regrettons sincèrement que votre expérience n'ait pas été à la hauteur de vos attentes. N'hésitez pas à nous contacter directement si vous souhaitez nous en dire plus.`
    }
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
    if (isEmptyContent) {
      if (rating >= 4) {
        return `${greeting}herzlichen Dank für die tolle ${rating}-Sterne-Bewertung! Wir freuen uns sehr über Ihre Unterstützung und auf Ihren nächsten Besuch.`
      }
      if (rating === 3) {
        return `${greeting}vielen Dank für Ihre Bewertung. Wir hoffen, Sie bei Ihrem nächsten Besuch vollends von uns überzeugen zu können.`
      }
      return `${greeting}vielen Dank für Ihre Rückmeldung. Es tut uns leid, dass Ihr Besuch nicht Ihren Erwartungen entsprochen hat. Wenn Sie uns weitere Details mitteilen möchten, freuen wir uns über eine direkte Nachricht.`
    }
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
    if (isEmptyContent) {
      if (rating >= 4) {
        return `${greeting}${rating}-star rating ke liye aapka bohot-bohot dhanyawad! Hum aapse dobara milne ke liye utsuk hain.`
      }
      if (rating === 3) {
        return `${greeting}rating ke liye dhanyawad. Hum ummeed karte hain ki agali baar aapko 5-star anubhav de sakein.`
      }
      return `${greeting}feedback ke liye dhanyawad. Hume dukh hai ki aapka anubhav achha nahi raha. Kripya humari management team se seedhe sampark karein taaki hum isme sudhaar kar sakein.`
    }
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

  // Handle empty review text in English cleanly without inventing details
  if (isEmptyContent) {
    if (rating === 5) {
      return `${greeting}thank you so much for the 5-star rating! We truly appreciate your support of ${business} and hope to welcome you back soon.`
    }
    if (rating === 4) {
      return `${greeting}thank you for the 4-star rating! We appreciate your support and look forward to serving you again.`
    }
    if (rating === 3) {
      return `${greeting}thank you for taking a moment to rate us. We appreciate your feedback and hope to provide you with a 5-star experience on your next visit.`
    }
    if (rating === 2) {
      return `${greeting}thank you for sharing your rating. We are sorry to see that your visit fell short of expectations. If you are open to sharing more details, please feel free to contact our management team directly so we can learn and improve.`
    }
    return `${greeting}thank you for your rating. We are sincerely sorry that your experience did not meet expectations. We would appreciate the chance to learn more—please contact our management team directly so we can look into this and assist you.`
  }

  // Extract specific complaint/praise topic if available
  let complaintTopic = 'your recent experience'
  if (/wait|delayed|slow|timing|hour|minute|queue|line/.test(lowerContent)) {
    complaintTopic = 'the wait time and delay you experienced'
  } else if (/staff|rude|attitude|behavior|customer service|unhelpful|hostile|manager/.test(lowerContent)) {
    complaintTopic = 'the customer service shortcomings you encountered'
  } else if (/quality|product|food|item|broken|defective|taste|cold|burnt|stale/.test(lowerContent)) {
    complaintTopic = 'the quality issues you described with your order'
  } else if (/clean|dirty|hygiene|mess|smell|restroom|bathroom|table/.test(lowerContent)) {
    complaintTopic = 'the cleanliness concerns you observed'
  } else if (/price|expensive|cost|overpriced|charge|bill|billing|fee/.test(lowerContent)) {
    complaintTopic = 'the pricing concerns you mentioned'
  }

  let positiveTopic = 'our service'
  if (/friendly|helpful|kind|staff|team|welcoming|carlos|sarah|server|waiter|bartender/.test(lowerContent)) {
    positiveTopic = 'our friendly team and attentive service'
  } else if (/fast|quick|prompt|efficient|speed/.test(lowerContent)) {
    positiveTopic = 'the prompt and efficient service'
  } else if (/clean|beautiful|ambiance|atmosphere|decor|vibe|music/.test(lowerContent)) {
    positiveTopic = 'the welcoming atmosphere and ambiance'
  } else if (/quality|great|awesome|delicious|amazing|fresh|tasty|favorite/.test(lowerContent)) {
    positiveTopic = 'the high quality and flavors of what we prepared'
  }

  // Detect mixed sentiment (both positive and negative points raised)
  const hasPositiveAspect = /good|great|delicious|enjoyed|liked|loved|nice|friendly|decent|tasty|pretty good/.test(lowerContent)
  const hasNegativeAspect = /but|however|although|though|except|wait|slow|expensive|pricey|could be better|wish|disappoint/.test(lowerContent)
  const isMixedSentiment = hasPositiveAspect && hasNegativeAspect

  // Tone-specific nuances
  const isConcise = input.tone === 'concise'
  const isEmpathetic = input.tone === 'empathetic'
  const isFriendly = input.tone === 'friendly'

  // Rating 1: Acknowledge specific complaint, apologize empathetically, offer professional resolution path
  if (rating === 1) {
    if (isConcise) {
      return `${greeting}we sincerely apologize for ${complaintTopic}. Please reach out directly to our management team so we can discuss this and assist you.`
    }
    if (isEmpathetic) {
      return `${greeting}we are deeply sorry to hear about ${complaintTopic}. We completely understand your frustration and regret that we let you down. We would truly appreciate the opportunity to make this right—please contact our management team directly so we can personally assist you.`
    }
    return `${greeting}thank you for bringing this to our attention. We sincerely apologize for ${complaintTopic}, as this does not reflect the standard of service we strive to deliver. Please reach out to our management team directly so we can look into what happened and work toward a resolution.`
  }

  // Rating 2: Address actual negative feedback, acknowledge what went wrong, offer practical next step
  if (rating === 2) {
    if (isConcise) {
      return `${greeting}thank you for your feedback regarding ${complaintTopic}. We apologize that things fell short; please contact our management team directly so we can assist you.`
    }
    if (isEmpathetic) {
      return `${greeting}we are truly sorry that your visit fell short regarding ${complaintTopic}. We understand how disappointing this was and would appreciate the chance to assist you—please reach out to our management team directly.`
    }
    return `${greeting}thank you for sharing your candid feedback with us. We are sorry that your experience fell short regarding ${complaintTopic}. Please reach out to our management team directly so we can assist you, as we are actively reviewing your comments with our team to improve.`
  }

  // Rating 3: Recognize both positive and negative points, respond constructively
  if (rating === 3) {
    if (isMixedSentiment) {
      return `${greeting}thank you for your balanced feedback. We are glad you appreciated ${positiveTopic}, while also acknowledging your notes on ${complaintTopic}. We appreciate your honesty and are using your comments to improve so your next visit is a 5-star one.`
    }
    if (isConcise) {
      return `${greeting}thank you for your review. We appreciate your feedback regarding ${complaintTopic} and are working to do better next time.`
    }
    return `${greeting}thank you for taking the time to leave a balanced review. We are glad you appreciated ${positiveTopic}, but we also acknowledge your feedback regarding ${complaintTopic}. We are using your notes constructively to improve and hope to welcome you back for a seamless visit.`
  }

  // Rating 4: Thank customer, acknowledge specific positive feedback and any suggestions
  if (rating === 4) {
    if (isMixedSentiment) {
      return `${greeting}thank you so much for the 4-star review! We are delighted to hear you enjoyed ${positiveTopic}, and we have also taken note of your feedback regarding ${complaintTopic}. We appreciate your support and look forward to earning that 5th star on your next visit!`
    }
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
    1: '1-STAR REVIEW RULES:\n- Specifically acknowledge the customer\'s complaint without being defensive.\n- Apologize sincerely for their negative experience.\n- Offer a clear, practical path to resolve the issue offline (e.g., invite them to contact management directly so we can assist them).\n- Never argue, never blame the customer, never claim the issue has already been resolved or investigated, and never make excuses.',
    2: '2-STAR REVIEW RULES:\n- Directly address the actual negative feedback or shortcomings described in the review.\n- Express regret that their visit or purchase fell short of expectations.\n- State our dedication to high standards and improving our service.',
    3: '3-STAR REVIEW RULES (MIXED/NEUTRAL):\n- Recognize BOTH the positive aspects and the negative or constructive criticisms mentioned.\n- Respond constructively, showing appreciation for their honest, balanced perspective.\n- Address their specific critiques and warmly invite them back.',
    4: '4-STAR REVIEW RULES:\n- Thank the customer warmly for their positive review.\n- Explicitly acknowledge the specific positive details they highlighted and any suggestions for improvement.\n- Express enthusiasm to welcome them back and earn that 5th star.',
    5: '5-STAR REVIEW RULES:\n- Enthusiastically thank the customer for the glowing 5-star rating.\n- Personalize the response by explicitly referencing specific dishes, products, staff members, or amenities highlighted in their review.\n- Express genuine gratitude and excitement to welcome them back.',
  }

  const businessDescription = input.businessContext ? `\nBusiness Context & Description: ${input.businessContext}` : ''

  const systemPrompt = `You are a professional reputation management assistant representing "${input.businessName || 'our business'}"${input.locationName ? ` at our ${input.locationName} location` : ''}.${businessDescription}
Your job is to compose a thoughtful, personalized, human-sounding public reply to a customer review on Google Business Profile.

Tone: ${tone.toUpperCase()} - ${toneInstructions[tone]}

${ratingSpecificGuidance[rating]}

MANDATORY RULES FOR ALL REPLIES:
1. SPECIFIC DETAIL CITATION (NO GENERIC REPLIES):
   - Carefully read the actual review text. Explicitly acknowledge the specific items, dishes, team members, wait times, or experiences mentioned by the reviewer.
   - Weave in the business context or specialties when naturally relevant to the customer's feedback.
   - Do NOT use generic, cookie-cutter templates.
2. MIXED / NEUTRAL REVIEWS:
   - If a customer mentions both positives and negatives (e.g., "Food was good but service was slow"), specifically address BOTH: praise their positive remarks and constructively acknowledge the critique.
3. NEGATIVE REVIEWS & SERIOUS COMPLAINTS (1-2 STARS):
   - Acknowledge the exact complaint empathetically and apologize sincerely where appropriate.
   - Offer a constructive next step: invite them to contact management directly so we can assist them.
   - NEVER argue, never dispute the customer's account, and never claim an investigation has concluded.
4. FACTUAL INTEGRITY & SAFETY:
   - NEVER invent facts, policies, or past interactions.
   - NEVER offer or promise monetary compensation, refunds, discounts, or free items.
   - NEVER promise specific disciplinary action or claim someone was penalized.
5. EMPTY REVIEW TEXT (RATING-ONLY):
   - If no review content was provided (only a star rating), write a brief, natural response (1-2 sentences) directly acknowledging the ${rating}-star rating.
   - DO NOT invent or assume any menu items, staff, or specific experiences.
   - For 4-5 stars: Warmly thank them for the rating.
   - For 1-3 stars: Thank them for rating us, express regret that their visit did not meet expectations, and invite them to reach out if they'd like to share details.
6. LANGUAGE MATCHING:
   - Automatically reply in the same language as the customer's review (e.g. Spanish for Spanish reviews, French for French, German for German, Hindi/Hinglish for Hindi, etc.).
   - Default to English if the review is in English or empty.
7. NATURAL, CONCISE & VARIED:
   - Keep the reply between 2 to 4 sentences (or 1-2 sentences for concise tone or empty reviews).
   - Avoid tired cliches like "We strive for excellence". Sound like a genuine, caring business owner.
8. OUTPUT FORMAT:
   - Output ONLY the final response text.
   - DO NOT include quotes around the text, email/phone placeholders, or signatures like "[Your Name]".`

  const userMessage = `Customer Name: ${input.authorName || 'Valued Customer'}
Rating: ${rating} / 5 stars
${input.locationName ? `Location: ${input.locationName}` : ''}
${input.businessContext ? `Business Context: ${input.businessContext}` : ''}
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
