import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateReviewReply, ReplyTone } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { verifyWorkspaceMembership } from '@/lib/workspace'
import { getWorkspaceReplySettings } from '@/lib/reply-safety'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You must be logged in to generate replies.' },
        { status: 401 }
      )
    }

    // Rate limiting: 10 requests / minute
    const rateLimit = checkRateLimit(user.id, 10, 60 * 1000)
    if (!rateLimit.success) {
      const seconds = Math.ceil(rateLimit.resetMs / 1000)
      return NextResponse.json(
        {
          success: false,
          error: `Rate limit exceeded. Please wait ${seconds} seconds before generating another reply.`,
        },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { authorName, rating, reviewContent, locationName, tone, workspaceId } = body

    const content = typeof reviewContent === 'string' ? reviewContent.trim() : ''


    const numericRating = Number(rating) || 5
    if (numericRating < 1 || numericRating > 5) {
      return NextResponse.json(
        { success: false, error: 'Rating must be between 1 and 5.' },
        { status: 400 }
      )
    }

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'workspaceId is required.' },
        { status: 400 }
      )
    }

    const membership = await verifyWorkspaceMembership(supabase, workspaceId)
    if (!membership.isMember) {
      return NextResponse.json(
        { success: false, error: membership.error || 'Forbidden workspace access.' },
        { status: 403 }
      )
    }

    const validTones: ReplyTone[] = ['professional', 'friendly', 'concise', 'empathetic']
    const selectedTone: ReplyTone = validTones.includes(tone) ? tone : 'professional'

    const [settings, workspaceRes, connectedLocRes] = await Promise.all([
      getWorkspaceReplySettings(supabase, workspaceId),
      supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
      supabase
        .from('locations')
        .select('name')
        .eq('workspace_id', workspaceId)
        .eq('is_connected', true)
        .limit(1)
        .maybeSingle(),
    ])

    const resolvedLocationName =
      (typeof locationName === 'string' && locationName.trim()) ||
      connectedLocRes.data?.name ||
      undefined

    const result = await generateReviewReply({
      authorName,
      rating: numericRating,
      reviewContent: content,
      locationName: resolvedLocationName,
      workspaceName: workspaceRes.data?.name || undefined,
      businessContext: settings.businessContext || undefined,
      tone: selectedTone,
    })

    if (!result.success) {
      return NextResponse.json(result, { status: 502 })
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
