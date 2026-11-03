-- ============================================================================
-- Migration: Add status and updated_at to workspace_invitations
-- Supports lifecycle tracking: 'pending', 'accepted', 'expired', 'revoked'
-- ============================================================================

ALTER TABLE public.workspace_invitations 
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending' 
  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'));

ALTER TABLE public.workspace_invitations 
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Update RLS policies to allow admins and owners to update invitations
DROP POLICY IF EXISTS "Admins and owners can update invitations" ON public.workspace_invitations;
CREATE POLICY "Admins and owners can update invitations"
  ON public.workspace_invitations FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_status ON public.workspace_invitations(status);

