-- Migration: 20261118160000_add_google_notification_registrations.sql
-- Description: Multi-tenant Google Business Profile account-scoped Pub/Sub notification
--              registrations, fenced distributed account registration locks, atomic
--              location claiming with cross-workspace exclusivity, and strict RLS.
-- Target: Supabase / PostgreSQL (STAGING ONLY: tbguitzuqyetvwughohp)
-- Rollback policy: Disable via GOOGLE_PUBSUB_TOPIC kill-switch & revert application code.
--                  NEVER automatically drop tables or delete audit/diagnostic history.

-- ============================================================================
-- 1. Non-Destructive Duplicate Active Location Preflight & Partial Unique Index
-- ============================================================================
DO $$
DECLARE
  v_dups text;
BEGIN
  SELECT string_agg(norm_loc || ' (count=' || cnt::text || ')', ', ')
  INTO v_dups
  FROM (
    SELECT lower(regexp_replace(trim(google_location_id), '^/?locations/', '', 'i')) AS norm_loc,
           count(*) AS cnt
    FROM public.locations
    WHERE is_connected = true
      AND google_location_id IS NOT NULL
      AND trim(google_location_id) <> ''
    GROUP BY 1
    HAVING count(*) > 1
  ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'Migration aborted (zero rows modified): duplicate active normalized google_location_id detected: %. Resolve explicitly before applying unique index.', v_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_one_active_per_google_location
  ON public.locations (lower(regexp_replace(trim(google_location_id), '^/?locations/', '', 'i')))
  WHERE is_connected = true
    AND google_location_id IS NOT NULL
    AND trim(google_location_id) <> '';

-- ============================================================================
-- 2. Account-Scoped Notification Registrations (NO location_id column)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.google_notification_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  google_account_id text NOT NULL,
  pubsub_topic text,
  notification_types text[] NOT NULL DEFAULT ARRAY['NEW_REVIEW', 'UPDATED_REVIEW'],
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'registered', 'failed', 'skipped_unconfigured', 'topic_conflict')
  ),
  source text NOT NULL DEFAULT 'auto_registration' CHECK (
    source IN ('auto_registration', 'reconciled_existing', 'manual_retry', 'worker_retry', 'explicit_overwrite')
  ),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  registered_at timestamptz,
  last_verified_at timestamptz,
  last_http_status integer,
  last_error_code text,
  last_error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_workspace_google_account_notif UNIQUE (workspace_id, google_account_id),
  CONSTRAINT google_notif_reg_canonical_account_chk CHECK (google_account_id ~ '^accounts/[^/\s]+$'),
  CONSTRAINT google_notif_reg_topic_required_chk CHECK (
    status IN ('skipped_unconfigured', 'topic_conflict')
    OR (pubsub_topic IS NOT NULL AND length(trim(pubsub_topic)) > 0)
  )
);

DROP TRIGGER IF EXISTS trigger_google_notif_reg_updated_at ON public.google_notification_registrations;
CREATE TRIGGER trigger_google_notif_reg_updated_at
  BEFORE UPDATE ON public.google_notification_registrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_google_notif_reg_due_retry
  ON public.google_notification_registrations (status, next_retry_at)
  WHERE status IN ('pending', 'failed', 'skipped_unconfigured');

CREATE INDEX IF NOT EXISTS idx_google_notif_reg_drift_verify
  ON public.google_notification_registrations (last_verified_at)
  WHERE status = 'registered';

CREATE INDEX IF NOT EXISTS idx_google_notif_reg_ws_status
  ON public.google_notification_registrations (workspace_id, status);

ALTER TABLE public.google_notification_registrations ENABLE ROW LEVEL SECURITY;

-- Strict RLS: Authenticated workspace members have SELECT ONLY for their own workspace.
-- All registration writes execute strictly via server-side service_role after server RBAC verification.
DROP POLICY IF EXISTS "Members can view workspace google notification registrations"
  ON public.google_notification_registrations;
CREATE POLICY "Members can view workspace google notification registrations"
  ON public.google_notification_registrations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 3. Cross-Process Account-Level Fenced Lock Table (Zero Tenant Data, service_role Only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.google_account_registration_locks (
  google_account_id text PRIMARY KEY CHECK (google_account_id ~ '^accounts/[^/\s]+$'),
  lock_owner text NOT NULL,
  fence_token bigint NOT NULL DEFAULT 1,
  locked_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_account_registration_locks ENABLE ROW LEVEL SECURITY;
-- Zero RLS policies for anon/authenticated: strictly service_role via RPCs only.

-- ============================================================================
-- 4. Atomic Location Claim & Activation RPC (service_role Only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_and_activate_google_location(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_google_account_id text,
  p_google_location_id text,
  p_name text,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_google_place_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_loc_bare text;
  v_norm_loc text;
  v_norm_acc_bare text;
  v_norm_account text;
  v_existing_id uuid;
  v_location_id uuid;
  v_is_authorized boolean;
BEGIN
  IF p_actor_user_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'unauthorized', true,
      'conflict', false,
      'location_id', null
    );
  END IF;

  -- Defense-in-depth: Re-validate actor's owner/admin workspace membership inside the RPC
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_actor_user_id
      AND wm.role IN ('owner', 'admin')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'unauthorized', true,
      'conflict', false,
      'location_id', null
    );
  END IF;

  v_norm_loc_bare := lower(regexp_replace(trim(coalesce(p_google_location_id, '')), '^/?locations/', '', 'i'));
  v_norm_acc_bare := lower(regexp_replace(trim(coalesce(p_google_account_id, '')), '^/?accounts/', '', 'i'));

  IF v_norm_loc_bare = '' OR v_norm_loc_bare ~ '[[:space:]/]' OR v_norm_acc_bare = '' OR v_norm_acc_bare ~ '[[:space:]/]' THEN
    RAISE EXCEPTION 'Invalid Google account or location identifier.';
  END IF;

  v_norm_loc := 'locations/' || v_norm_loc_bare;
  v_norm_account := 'accounts/' || v_norm_acc_bare;

  -- Acquire deterministic transaction-scoped advisory locks to prevent deadlocks & races
  PERFORM pg_advisory_xact_lock(hashtext('nexrep_loc_claim:' || v_norm_loc_bare));
  PERFORM pg_advisory_xact_lock(hashtext('nexrep_ws_loc:' || p_workspace_id::text));

  -- Cross-workspace active exclusivity check (returns privacy-safe boolean conflict only)
  IF EXISTS (
    SELECT 1
    FROM public.locations l
    WHERE l.is_connected = true
      AND l.workspace_id <> p_workspace_id
      AND lower(regexp_replace(trim(coalesce(l.google_location_id, '')), '^/?locations/', '', 'i')) = v_norm_loc_bare
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'unauthorized', false,
      'conflict', true,
      'location_id', null
    );
  END IF;

  -- Deactivate any other connected locations in this workspace
  UPDATE public.locations
  SET is_connected = false,
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND is_connected = true;

  -- Locate existing row in this workspace matching normalized google_location_id
  SELECT id INTO v_existing_id
  FROM public.locations
  WHERE workspace_id = p_workspace_id
    AND lower(regexp_replace(trim(coalesce(google_location_id, '')), '^/?locations/', '', 'i')) = v_norm_loc_bare
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.locations
    SET name = p_name,
        address = p_address,
        phone = p_phone,
        google_place_id = p_google_place_id,
        google_account_id = v_norm_account,
        google_location_id = v_norm_loc,
        is_connected = true,
        updated_at = now()
    WHERE id = v_existing_id
    RETURNING id INTO v_location_id;
  ELSE
    INSERT INTO public.locations (
      workspace_id,
      name,
      address,
      phone,
      google_place_id,
      google_account_id,
      google_location_id,
      is_connected
    )
    VALUES (
      p_workspace_id,
      p_name,
      p_address,
      p_phone,
      p_google_place_id,
      v_norm_account,
      v_norm_loc,
      true
    )
    RETURNING id INTO v_location_id;
  END IF;

  -- Update workspace google_integrations with authoritative normalized GBP account ID
  UPDATE public.google_integrations
  SET account_id = v_norm_account,
      updated_at = now()
  WHERE workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'unauthorized', false,
    'conflict', false,
    'location_id', v_location_id,
    'google_account_id', v_norm_account,
    'google_location_id', v_norm_loc
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'unauthorized', false,
      'conflict', true,
      'location_id', null
    );
END;
$$;

-- ============================================================================
-- 5. Fenced Cross-Process Account Registration Lock RPCs (service_role Only)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.acquire_google_account_registration_lock(
  p_google_account_id text,
  p_lock_owner text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_acc_bare text;
  v_norm_account text;
  v_ttl integer;
  v_fence bigint;
  v_expires timestamptz;
BEGIN
  v_norm_acc_bare := lower(regexp_replace(trim(coalesce(p_google_account_id, '')), '^/?accounts/', '', 'i'));
  IF v_norm_acc_bare = '' OR v_norm_acc_bare ~ '[[:space:]/]' OR trim(coalesce(p_lock_owner, '')) = '' THEN
    RAISE EXCEPTION 'Invalid google_account_id or lock_owner.';
  END IF;

  v_norm_account := 'accounts/' || v_norm_acc_bare;
  v_ttl := GREATEST(10, LEAST(COALESCE(p_lease_seconds, 60), 180));

  INSERT INTO public.google_account_registration_locks (
    google_account_id,
    lock_owner,
    fence_token,
    locked_at,
    lease_expires_at,
    updated_at
  )
  VALUES (
    v_norm_account,
    p_lock_owner,
    1,
    now(),
    now() + make_interval(secs => v_ttl),
    now()
  )
  ON CONFLICT (google_account_id) DO UPDATE
    SET lock_owner = EXCLUDED.lock_owner,
        fence_token = public.google_account_registration_locks.fence_token + 1,
        locked_at = now(),
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = now()
    WHERE public.google_account_registration_locks.lease_expires_at <= now()
  RETURNING fence_token, lease_expires_at INTO v_fence, v_expires;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'acquired', true,
      'fence_token', v_fence,
      'lease_expires_at', v_expires
    );
  END IF;

  SELECT lease_expires_at INTO v_expires
  FROM public.google_account_registration_locks
  WHERE google_account_id = v_norm_account;

  RETURN jsonb_build_object(
    'acquired', false,
    'fence_token', null,
    'lease_expires_at', v_expires
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_google_account_registration_lock(
  p_google_account_id text,
  p_lock_owner text,
  p_fence_token bigint,
  p_lease_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_acc_bare text;
  v_norm_account text;
  v_ttl integer;
BEGIN
  v_norm_acc_bare := lower(regexp_replace(trim(coalesce(p_google_account_id, '')), '^/?accounts/', '', 'i'));
  IF v_norm_acc_bare = '' OR v_norm_acc_bare ~ '[[:space:]/]' OR p_fence_token IS NULL THEN
    RETURN false;
  END IF;

  v_norm_account := 'accounts/' || v_norm_acc_bare;
  v_ttl := GREATEST(10, LEAST(COALESCE(p_lease_seconds, 60), 180));

  UPDATE public.google_account_registration_locks
  SET lease_expires_at = now() + make_interval(secs => v_ttl),
      updated_at = now()
  WHERE google_account_id = v_norm_account
    AND lock_owner = p_lock_owner
    AND fence_token = p_fence_token
    AND lease_expires_at > now();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_google_account_registration_lock(
  p_google_account_id text,
  p_lock_owner text,
  p_fence_token bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_acc_bare text;
  v_norm_account text;
BEGIN
  v_norm_acc_bare := lower(regexp_replace(trim(coalesce(p_google_account_id, '')), '^/?accounts/', '', 'i'));
  IF v_norm_acc_bare = '' OR v_norm_acc_bare ~ '[[:space:]/]' OR p_fence_token IS NULL THEN
    RETURN false;
  END IF;

  v_norm_account := 'accounts/' || v_norm_acc_bare;

  DELETE FROM public.google_account_registration_locks
  WHERE google_account_id = v_norm_account
    AND lock_owner = p_lock_owner
    AND fence_token = p_fence_token;

  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 6. Strict Explicit REVOKE / GRANT Statements (service_role ONLY)
-- ============================================================================
REVOKE ALL ON FUNCTION public.claim_and_activate_google_location(
  uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_and_activate_google_location(
  uuid, uuid, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.acquire_google_account_registration_lock(
  text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_google_account_registration_lock(
  text, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.renew_google_account_registration_lock(
  text, text, bigint, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_google_account_registration_lock(
  text, text, bigint, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.release_google_account_registration_lock(
  text, text, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_google_account_registration_lock(
  text, text, bigint
) TO service_role;
