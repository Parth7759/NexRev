-- Migration: 20261023000000_single_connected_business_profile.sql
-- Description: Enforce at most one actively connected Google Business Profile per workspace (non-destructive, zero default)
-- Target: Supabase / PostgreSQL

-- 1. Identify any workspaces that have multiple active connected profiles (unconfigured/legacy state).
-- Deactivate all connections in ambiguous workspaces so the user is required to make an explicit choice.
-- Does NOT pick an arbitrary default based on updated_at or created_at.
WITH ambiguous_workspaces AS (
  SELECT workspace_id
  FROM public.locations
  WHERE is_connected = true
  GROUP BY workspace_id
  HAVING count(*) > 1
)
UPDATE public.locations
SET is_connected = false,
    updated_at = now()
WHERE workspace_id IN (
  SELECT workspace_id FROM ambiguous_workspaces
)
AND is_connected = true;

-- 2. Create partial unique index guaranteeing exactly zero or one active profile per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_connected_location_per_workspace
  ON public.locations (workspace_id)
  WHERE (is_connected = true);

-- 3. Comments for documentation integrity
COMMENT ON INDEX public.idx_single_connected_location_per_workspace IS
  'Guarantees that each workspace can have at most one active Google Business Profile connection at any time.';
