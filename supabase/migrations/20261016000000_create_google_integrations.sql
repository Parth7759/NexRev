-- Migration: 20261016000000_create_google_integrations.sql
-- Description: Secure storage for Google Business Profile OAuth tokens with Row Level Security (RLS)
-- Target: Supabase / PostgreSQL

CREATE TABLE IF NOT EXISTS public.google_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id text,
  account_name text,
  scope text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT unique_workspace_google_integration UNIQUE (workspace_id)
);

-- Trigger for auto-updating updated_at timestamp
DROP TRIGGER IF EXISTS trigger_google_integrations_updated_at ON public.google_integrations;
CREATE TRIGGER trigger_google_integrations_updated_at
  BEFORE UPDATE ON public.google_integrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Members can view their workspace Google integration status" ON public.google_integrations;
CREATE POLICY "Members can view their workspace Google integration status"
  ON public.google_integrations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can insert Google integration" ON public.google_integrations;
CREATE POLICY "Admins and owners can insert Google integration"
  ON public.google_integrations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can update Google integration" ON public.google_integrations;
CREATE POLICY "Admins and owners can update Google integration"
  ON public.google_integrations FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can delete Google integration" ON public.google_integrations;
CREATE POLICY "Admins and owners can delete Google integration"
  ON public.google_integrations FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_google_integrations_workspace_id ON public.google_integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_google_integrations_connected_by ON public.google_integrations(connected_by);
