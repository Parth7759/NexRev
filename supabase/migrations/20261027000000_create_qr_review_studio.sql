
-- ============================================================================
-- Migration: 20261027000000_create_qr_review_studio.sql
-- Description: Schema for NexRep QR Review Studio and public review landing pages
-- Security: Multi-tenant Row Level Security (RLS) & Minimal Public Exposure
-- Target: Supabase / PostgreSQL
-- ============================================================================

-- 1. QR CODES TABLE
CREATE TABLE IF NOT EXISTS public.qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  public_slug text UNIQUE NOT NULL,
  title text NOT NULL DEFAULT 'Review Us on Google',
  call_to_action text NOT NULL DEFAULT 'Scan the QR code to share your genuine experience',
  custom_google_review_url text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Trigger for qr_codes updated_at
DROP TRIGGER IF EXISTS trigger_qr_codes_updated_at ON public.qr_codes;
CREATE TRIGGER trigger_qr_codes_updated_at
  BEFORE UPDATE ON public.qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Function and trigger enforcing that location_id belongs to workspace_id
-- Uses row-level SHARE lock to prevent concurrent location workspace reassignment races
CREATE OR REPLACE FUNCTION public.check_qr_code_workspace_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.locations
  WHERE id = NEW.location_id
    AND workspace_id = NEW.workspace_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cross-workspace integrity violation: Location % does not belong to workspace %', NEW.location_id, NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_qr_code_workspace_location() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_check_qr_code_workspace_location ON public.qr_codes;
CREATE TRIGGER trigger_check_qr_code_workspace_location
  BEFORE INSERT OR UPDATE OF workspace_id, location_id ON public.qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.check_qr_code_workspace_location();

-- Companion trigger on locations to prevent transferring a location to another workspace while QR codes exist
CREATE OR REPLACE FUNCTION public.check_location_workspace_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    IF EXISTS (SELECT 1 FROM public.qr_codes WHERE location_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot reassign location % to a different workspace while QR codes are bound to it', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_location_workspace_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS trigger_check_location_workspace_integrity ON public.locations;
CREATE TRIGGER trigger_check_location_workspace_integrity
  BEFORE UPDATE OF workspace_id ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.check_location_workspace_integrity();

-- 2. QR CODE EVENTS / TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS public.qr_code_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid NOT NULL REFERENCES public.qr_codes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('scan', 'google_click', 'suggestion_generated')),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_code_events ENABLE ROW LEVEL SECURITY;

-- 1. Workspace members can view their QR codes
DROP POLICY IF EXISTS "Members can view workspace QR codes" ON public.qr_codes;
CREATE POLICY "Members can view workspace QR codes"
  ON public.qr_codes FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- 2. Workspace admins and owners can insert/update/delete QR codes (strictly within their workspace and locations)
DROP POLICY IF EXISTS "Admins and owners can manage QR codes" ON public.qr_codes;
CREATE POLICY "Admins and owners can manage QR codes"
  ON public.qr_codes FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    AND EXISTS (
      SELECT 1 FROM public.locations
      WHERE public.locations.id = qr_codes.location_id
        AND public.locations.workspace_id = qr_codes.workspace_id
    )
  );

-- Remove direct public SELECT on qr_codes to prevent anonymous scraping/enumeration.
-- Public access is strictly mediated by get_public_qr_landing_data() SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Public can view active QR codes" ON public.qr_codes;

-- 3. Workspace members can view QR analytics events
DROP POLICY IF EXISTS "Members can view QR events" ON public.qr_code_events;
CREATE POLICY "Members can view QR events"
  ON public.qr_code_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

-- Remove direct public INSERT on qr_code_events to prevent telemetry inflation and payload bloat.
-- Public telemetry logging is mediated by record_public_qr_event() SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Public can record QR events" ON public.qr_code_events;

-- Clean up any legacy public location policy so anonymous users cannot enumerate locations
DROP POLICY IF EXISTS "Public can view locations for active QR codes" ON public.locations;

-- ============================================================================
-- MINIMAL PUBLIC DATA RPC FUNCTION
-- Returns only the minimum public display data for active QR codes by exact slug,
-- preventing mass scraping of workspace_id, internal metadata, or locations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_qr_landing_data(target_slug text)
RETURNS TABLE (
  id uuid,
  title text,
  call_to_action text,
  custom_google_review_url text,
  business_name text,
  address text,
  google_place_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    q.id,
    q.title,
    q.call_to_action,
    q.custom_google_review_url,
    l.name AS business_name,
    l.address,
    l.google_place_id
  FROM public.qr_codes q
  JOIN public.locations l ON l.id = q.location_id
  WHERE q.public_slug = target_slug
    AND q.is_active = true
  LIMIT 1;
$$;

-- Revoke default public execution rights and grant explicitly to application roles
REVOKE ALL ON FUNCTION public.get_public_qr_landing_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_qr_landing_data(text) TO anon, authenticated;

-- ============================================================================
-- PUBLIC TELEMETRY RECORDING RPC FUNCTION
-- Safely records scan and interaction events for active QR codes without exposing
-- workspace_id or allowing arbitrary table inserts / metadata inflation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_public_qr_event(
  p_qr_code_id uuid,
  p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  -- Strict validation of permitted event types
  IF p_event_type NOT IN ('scan', 'google_click', 'suggestion_generated') THEN
    RETURN false;
  END IF;

  -- Ensure QR code exists and is active, and fetch its workspace_id internally
  SELECT workspace_id INTO v_workspace_id
  FROM public.qr_codes
  WHERE id = p_qr_code_id
    AND is_active = true;

  IF v_workspace_id IS NULL THEN
    RETURN false;
  END IF;

  -- Insert event record with system-verified workspace_id
  INSERT INTO public.qr_code_events (
    qr_code_id,
    workspace_id,
    event_type,
    metadata
  ) VALUES (
    p_qr_code_id,
    v_workspace_id,
    p_event_type,
    '{}'::jsonb
  );

  RETURN true;
END;
$$;

-- Revoke default public execution rights and grant explicitly to application roles
REVOKE ALL ON FUNCTION public.record_public_qr_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_public_qr_event(uuid, text) TO anon, authenticated;

-- ============================================================================
-- PERFORMANCE & INTEGRITY INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qr_codes_workspace_id ON public.qr_codes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_location_id ON public.qr_codes(location_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_workspace_location ON public.qr_codes(workspace_id, location_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_public_slug ON public.qr_codes(public_slug);
CREATE INDEX IF NOT EXISTS idx_qr_code_events_qr_code_id ON public.qr_code_events(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_code_events_workspace_id ON public.qr_code_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_qr_code_events_type ON public.qr_code_events(event_type);

-- ============================================================================
-- TABLE PERMISSIONS
-- Explicit grants enabling RLS evaluation for authenticated and service roles
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qr_codes TO authenticated;
GRANT SELECT ON TABLE public.qr_code_events TO authenticated;
GRANT ALL ON TABLE public.qr_codes TO service_role;
GRANT ALL ON TABLE public.qr_code_events TO service_role;


