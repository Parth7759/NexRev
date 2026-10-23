-- Migration: 20261022000000_add_reply_safety_and_settings.sql
-- Description: Configurable reply safety settings, audit logging, and team invitations for NexRep
-- Target: Supabase / PostgreSQL

-- 1. WORKSPACE SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  auto_reply_mode text NOT NULL DEFAULT 'manual_approval' CHECK (auto_reply_mode IN ('manual_approval', 'auto_publish_positive', 'auto_publish_all')),
  require_approval_for_critical boolean NOT NULL DEFAULT true,
  default_reply_tone text NOT NULL DEFAULT 'professional' CHECK (default_reply_tone IN ('professional', 'friendly', 'concise', 'empathetic')),
  business_context text NOT NULL DEFAULT '',
  auto_reply_min_rating integer NOT NULL DEFAULT 4 CHECK (auto_reply_min_rating >= 1 AND auto_reply_min_rating <= 5),
  auto_reply_delay_minutes integer NOT NULL DEFAULT 5 CHECK (auto_reply_delay_minutes >= 0),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Trigger for workspace_settings updated_at
DROP TRIGGER IF EXISTS trigger_workspace_settings_updated_at ON public.workspace_settings;
CREATE TRIGGER trigger_workspace_settings_updated_at
  BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. REVIEW REPLY LOGS / AUDIT TRAIL TABLE
CREATE TABLE IF NOT EXISTS public.review_reply_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  reply_id uuid REFERENCES public.review_replies(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('generated', 'edited', 'published', 'failed')),
  content text,
  tone text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- 3. WORKSPACE INVITATIONS TABLE
CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT unique_workspace_invitation_email UNIQUE (workspace_id, email)
);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reply_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Workspace Settings Policies
DROP POLICY IF EXISTS "Members can view workspace settings" ON public.workspace_settings;
CREATE POLICY "Members can view workspace settings"
  ON public.workspace_settings FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can update workspace settings" ON public.workspace_settings;
CREATE POLICY "Admins and owners can update workspace settings"
  ON public.workspace_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can modify workspace settings" ON public.workspace_settings;
CREATE POLICY "Admins and owners can modify workspace settings"
  ON public.workspace_settings FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- Review Reply Logs Policies
DROP POLICY IF EXISTS "Members can view review reply logs" ON public.review_reply_logs;
CREATE POLICY "Members can view review reply logs"
  ON public.review_reply_logs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can insert review reply logs" ON public.review_reply_logs;
CREATE POLICY "Members can insert review reply logs"
  ON public.review_reply_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

-- Workspace Invitations Policies
DROP POLICY IF EXISTS "Members can view workspace invitations" ON public.workspace_invitations;
CREATE POLICY "Members can view workspace invitations"
  ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can create invitations" ON public.workspace_invitations;
CREATE POLICY "Admins and owners can create invitations"
  ON public.workspace_invitations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can delete invitations" ON public.workspace_invitations;
CREATE POLICY "Admins and owners can delete invitations"
  ON public.workspace_invitations FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_settings_workspace_id ON public.workspace_settings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_review_reply_logs_review_id ON public.review_reply_logs(review_id);
CREATE INDEX IF NOT EXISTS idx_review_reply_logs_workspace_id ON public.review_reply_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_id ON public.workspace_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON public.workspace_invitations(email);

-- Ensure strictly one reply per review at the database level to prevent duplicate records
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_replies_unique_review ON public.review_replies(review_id);
