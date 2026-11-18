-- Migration: 20261118120000_add_delayed_reply_queue_and_worker_health.sql
-- Description: Delayed Google review reply job queue, atomic enqueue/claim RPCs,
--              Google OAuth/GBP connection health tracking, and worker heartbeats.
-- Target: Supabase / PostgreSQL (STAGING ONLY: tbguitzuqyetvwughohp)
-- Rollback policy: Pause Cloud Scheduler & revert application code ONLY.
--                  Do NOT automatically drop tables or delete audit/queue history.

-- 1. Widen review_automation_events.processing_status to allow 'scheduled' (preserves all existing rows)
ALTER TABLE public.review_automation_events
  DROP CONSTRAINT IF EXISTS review_automation_events_processing_status_check;

ALTER TABLE public.review_automation_events
  ADD CONSTRAINT review_automation_events_processing_status_check
  CHECK (processing_status IN (
    'received',
    'scheduled',
    'ai_generating',
    'publishing',
    'published',
    'failed',
    'skipped',
    'draft_saved'
  ));

-- 2. Create delayed reply job queue table: public.review_reply_jobs
CREATE TABLE IF NOT EXISTS public.review_reply_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  external_review_id text NOT NULL,
  source_event_id text,
  source_event_type text NOT NULL DEFAULT 'NEW_REVIEW' CHECK (
    source_event_type IN ('NEW_REVIEW', 'UPDATED_REVIEW', 'SYNC_RECONCILIATION')
  ),
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'processing', 'published', 'draft_saved', 'skipped', 'failed', 'dead_letter')
  ),
  scheduled_for timestamptz NOT NULL,
  locked_at timestamptz,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_error text,
  processed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trigger_review_reply_jobs_updated_at ON public.review_reply_jobs;
CREATE TRIGGER trigger_review_reply_jobs_updated_at
  BEFORE UPDATE ON public.review_reply_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Strict duplicate job protection: at most ONE open job (scheduled, processing, or failed waiting for retry) per review_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_reply_jobs_one_open_per_review
  ON public.review_reply_jobs (review_id)
  WHERE status IN ('scheduled', 'processing', 'failed');

-- Operational indexes for due-job claiming and dashboard queries
CREATE INDEX IF NOT EXISTS idx_review_reply_jobs_due
  ON public.review_reply_jobs (status, scheduled_for, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_review_reply_jobs_ws_status
  ON public.review_reply_jobs (workspace_id, status, created_at DESC);

ALTER TABLE public.review_reply_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view review reply jobs" ON public.review_reply_jobs;
CREATE POLICY "Members can view review reply jobs"
  ON public.review_reply_jobs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can insert review reply jobs" ON public.review_reply_jobs;
CREATE POLICY "Admins and owners can insert review reply jobs"
  ON public.review_reply_jobs FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can update review reply jobs" ON public.review_reply_jobs;
CREATE POLICY "Admins and owners can update review reply jobs"
  ON public.review_reply_jobs FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can delete review reply jobs" ON public.review_reply_jobs;
CREATE POLICY "Admins and owners can delete review reply jobs"
  ON public.review_reply_jobs FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- 3. Create verified Google OAuth & GBP API connectivity health table (zero modifications to google_integrations)
CREATE TABLE IF NOT EXISTS public.google_connection_health (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unknown' CHECK (
    status IN (
      'unknown',
      'connected_verified',
      'token_stored_unverified',
      'refresh_failed',
      'revoked',
      'api_error',
      'disconnected'
    )
  ),
  token_stored boolean NOT NULL DEFAULT false,
  has_required_scope boolean NOT NULL DEFAULT false,
  last_refresh_succeeded_at timestamptz,
  last_gbp_api_verified_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trigger_google_connection_health_updated_at ON public.google_connection_health;
CREATE TRIGGER trigger_google_connection_health_updated_at
  BEFORE UPDATE ON public.google_connection_health
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.google_connection_health ENABLE ROW LEVEL SECURITY;

-- Workspace members can read verified health; ONLY service_role can write verified probe results
DROP POLICY IF EXISTS "Members can view google connection health" ON public.google_connection_health;
CREATE POLICY "Members can view google connection health"
  ON public.google_connection_health FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- 4. Create background worker heartbeat/runs table (non-PII operational telemetry)
CREATE TABLE IF NOT EXISTS public.automation_worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'cloud_scheduler',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  claimed_count integer NOT NULL DEFAULT 0,
  published_count integer NOT NULL DEFAULT 0,
  draft_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_worker_runs_started
  ON public.automation_worker_runs (started_at DESC);

ALTER TABLE public.automation_worker_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view worker run heartbeats" ON public.automation_worker_runs;
CREATE POLICY "Authenticated users can view worker run heartbeats"
  ON public.automation_worker_runs FOR SELECT TO authenticated
  USING (true);

-- 5. Atomic enqueue/upsert RPC: guarantees zero duplicate open jobs and handles NEW_REVIEW / UPDATED_REVIEW safely
CREATE OR REPLACE FUNCTION public.enqueue_review_reply_job(
  p_workspace_id uuid,
  p_location_id uuid,
  p_review_id uuid,
  p_external_review_id text,
  p_source_event_id text,
  p_source_event_type text,
  p_scheduled_for timestamptz,
  p_max_attempts integer DEFAULT 5,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reply_status text;
  v_job public.review_reply_jobs%ROWTYPE;
  v_event_type text;
BEGIN
  v_event_type := CASE
    WHEN p_source_event_type IN ('NEW_REVIEW', 'UPDATED_REVIEW', 'SYNC_RECONCILIATION')
      THEN p_source_event_type
    ELSE 'NEW_REVIEW'
  END;

  -- Check if review already has a published reply (never schedule duplicate reply)
  SELECT status INTO v_reply_status
  FROM public.review_replies
  WHERE review_id = p_review_id
    AND workspace_id = p_workspace_id
    AND status = 'published'
  LIMIT 1;

  IF v_reply_status = 'published' THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'deduplicated', true,
      'reason', 'already_published',
      'job_id', null,
      'status', 'skipped',
      'scheduled_for', null
    );
  END IF;

  -- Check if an existing draft reply already exists and no open job is present
  SELECT status INTO v_reply_status
  FROM public.review_replies
  WHERE review_id = p_review_id
    AND workspace_id = p_workspace_id
    AND status = 'draft'
  LIMIT 1;

  IF v_reply_status = 'draft' AND NOT EXISTS (
    SELECT 1 FROM public.review_reply_jobs
    WHERE review_id = p_review_id
      AND status IN ('scheduled', 'processing', 'failed')
  ) THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'deduplicated', true,
      'reason', 'draft_exists',
      'job_id', null,
      'status', 'skipped',
      'scheduled_for', null
    );
  END IF;

  -- Attempt atomic insert governed by partial unique index idx_review_reply_jobs_one_open_per_review
  INSERT INTO public.review_reply_jobs (
    workspace_id,
    location_id,
    review_id,
    external_review_id,
    source_event_id,
    source_event_type,
    status,
    scheduled_for,
    max_attempts,
    metadata
  )
  VALUES (
    p_workspace_id,
    p_location_id,
    p_review_id,
    p_external_review_id,
    p_source_event_id,
    v_event_type,
    'scheduled',
    p_scheduled_for,
    GREATEST(1, COALESCE(p_max_attempts, 5)),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (review_id) WHERE status IN ('scheduled', 'processing', 'failed')
  DO NOTHING
  RETURNING * INTO v_job;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'enqueued', true,
      'deduplicated', false,
      'reason', 'scheduled',
      'job_id', v_job.id,
      'status', v_job.status,
      'scheduled_for', v_job.scheduled_for
    );
  END IF;

  -- Conflict: an open job (scheduled, processing, or failed waiting for retry) already exists for this review_id
  SELECT * INTO v_job
  FROM public.review_reply_jobs
  WHERE review_id = p_review_id
    AND status IN ('scheduled', 'processing', 'failed')
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Rare race where the prior job completed right between conflict and lock; retry insert once
    INSERT INTO public.review_reply_jobs (
      workspace_id,
      location_id,
      review_id,
      external_review_id,
      source_event_id,
      source_event_type,
      status,
      scheduled_for,
      max_attempts,
      metadata
    )
    VALUES (
      p_workspace_id,
      p_location_id,
      p_review_id,
      p_external_review_id,
      p_source_event_id,
      v_event_type,
      'scheduled',
      p_scheduled_for,
      GREATEST(1, COALESCE(p_max_attempts, 5)),
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_job;

    RETURN jsonb_build_object(
      'enqueued', true,
      'deduplicated', false,
      'reason', 'scheduled',
      'job_id', v_job.id,
      'status', v_job.status,
      'scheduled_for', v_job.scheduled_for
    );
  END IF;

  -- Handle UPDATED_REVIEW cleanly without creating a duplicate job or shortening delay
  IF v_event_type = 'UPDATED_REVIEW' THEN
    IF v_job.status = 'scheduled' THEN
      UPDATE public.review_reply_jobs
      SET
        source_event_id = COALESCE(p_source_event_id, source_event_id),
        source_event_type = 'UPDATED_REVIEW',
        scheduled_for = GREATEST(scheduled_for, p_scheduled_for),
        metadata = metadata || jsonb_build_object('lastUpdatedEventId', p_source_event_id),
        updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    ELSIF v_job.status = 'failed' THEN
      UPDATE public.review_reply_jobs
      SET
        source_event_id = COALESCE(p_source_event_id, source_event_id),
        source_event_type = 'UPDATED_REVIEW',
        metadata = metadata || jsonb_build_object('lastUpdatedEventId', p_source_event_id),
        updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enqueued', false,
    'deduplicated', true,
    'reason', 'open_job_exists',
    'job_id', v_job.id,
    'status', v_job.status,
    'scheduled_for', v_job.scheduled_for
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_review_reply_job(
  uuid, uuid, uuid, text, text, text, timestamptz, integer, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_review_reply_job(
  uuid, uuid, uuid, text, text, text, timestamptz, integer, jsonb
) TO service_role;

-- 6. Atomic due-job claim RPC with FOR UPDATE SKIP LOCKED and strict scheduled_for <= now() enforcement
CREATE OR REPLACE FUNCTION public.claim_due_review_reply_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_stale_lock_minutes integer DEFAULT 10
)
RETURNS SETOF public.review_reply_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due_jobs AS (
    SELECT j.id
    FROM public.review_reply_jobs j
    WHERE (
      j.status = 'scheduled'
      AND j.scheduled_for <= now()
    )
    OR (
      j.status = 'failed'
      AND j.attempts < j.max_attempts
      AND j.scheduled_for <= now()
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= now())
    )
    OR (
      j.status = 'processing'
      AND j.scheduled_for <= now()
      AND j.locked_at IS NOT NULL
      AND j.locked_at < now() - make_interval(mins => GREATEST(1, COALESCE(p_stale_lock_minutes, 10)))
    )
    ORDER BY j.scheduled_for ASC, j.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.review_reply_jobs target
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    attempts = target.attempts + 1,
    updated_at = now()
  FROM due_jobs
  WHERE target.id = due_jobs.id
  RETURNING target.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_review_reply_jobs(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_review_reply_jobs(text, integer, integer)
  TO service_role;
