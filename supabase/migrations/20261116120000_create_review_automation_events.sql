-- Migration: 20261116120000_create_review_automation_events.sql
-- Description: Event-driven Google Business Profile review automation tracking, idempotency, and audit jobs.
-- Target: Supabase / PostgreSQL (Staging only: tbguitzuqyetvwughohp)

CREATE TABLE IF NOT EXISTS public.review_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE, -- Google Pub/Sub messageId or webhook idempotency token
  review_resource_id text,      -- accounts/{acc}/locations/{loc}/reviews/{rev}
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  review_id uuid REFERENCES public.reviews(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'NEW_REVIEW' CHECK (event_type IN ('NEW_REVIEW', 'UPDATED_REVIEW', 'SYNC_RECONCILIATION')),
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'ai_generating', 'publishing', 'published', 'failed', 'skipped', 'draft_saved')),
  ai_generated_reply text,
  publishing_status text NOT NULL DEFAULT 'pending' CHECK (publishing_status IN ('pending', 'published', 'failed', 'skipped', 'draft_saved')),
  retry_count integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Trigger for review_automation_events updated_at
DROP TRIGGER IF EXISTS trigger_review_automation_events_updated_at ON public.review_automation_events;
CREATE TRIGGER trigger_review_automation_events_updated_at
  BEFORE UPDATE ON public.review_automation_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Performance indexes for lightning-fast lookups and deduplication
CREATE INDEX IF NOT EXISTS idx_rev_auto_events_ws_status ON public.review_automation_events(workspace_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_rev_auto_events_review_res ON public.review_automation_events(review_resource_id);
CREATE INDEX IF NOT EXISTS idx_rev_auto_events_created ON public.review_automation_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.review_automation_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Members can view review automation events" ON public.review_automation_events;
CREATE POLICY "Members can view review automation events"
  ON public.review_automation_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Restrict mutations to workspace owners and admins (ordinary members have read-only access)
DROP POLICY IF EXISTS "Admins and owners can insert review automation events" ON public.review_automation_events;
CREATE POLICY "Admins and owners can insert review automation events"
  ON public.review_automation_events FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can update review automation events" ON public.review_automation_events;
CREATE POLICY "Admins and owners can update review automation events"
  ON public.review_automation_events FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can delete review automation events" ON public.review_automation_events;
CREATE POLICY "Admins and owners can delete review automation events"
  ON public.review_automation_events FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Members can manage review automation events" ON public.review_automation_events;

