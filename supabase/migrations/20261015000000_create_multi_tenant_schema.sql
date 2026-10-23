-- Migration: 20261015000000_create_multi_tenant_schema.sql
-- Description: Multi-tenant database foundation with Row Level Security (RLS) for NexRep
-- Target: Supabase / PostgreSQL

-- 0. Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES TABLE (Mirrors and extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 2. WORKSPACES / BUSINESSES TABLE
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 3. WORKSPACE MEMBERSHIPS TABLE
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT unique_workspace_user UNIQUE (workspace_id, user_id)
);

-- 4. LOCATIONS TABLE (Google Business Profile locations)
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  google_place_id text,
  google_account_id text,
  google_location_id text,
  is_connected boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 5. REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  author_photo_url text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content text,
  review_date timestamptz DEFAULT now() NOT NULL,
  source text DEFAULT 'google' CHECK (source IN ('google', 'manual', 'internal')),
  status text DEFAULT 'unanswered' CHECK (status IN ('unanswered', 'answered', 'flagged')),
  sentiment text DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  external_review_id text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 6. REVIEW REPLIES TABLE
CREATE TABLE IF NOT EXISTS public.review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content text NOT NULL,
  tone text DEFAULT 'professional',
  is_ai_generated boolean DEFAULT false NOT NULL,
  status text DEFAULT 'published' CHECK (status IN ('draft', 'published', 'failed')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- HELPER FUNCTIONS & TRIGGERS FOR TIMESTAMPS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trigger_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_workspace_members_updated_at ON public.workspace_members;
CREATE TRIGGER trigger_workspace_members_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_locations_updated_at ON public.locations;
CREATE TRIGGER trigger_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_reviews_updated_at ON public.reviews;
CREATE TRIGGER trigger_reviews_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_review_replies_updated_at ON public.review_replies;
CREATE TRIGGER trigger_review_replies_updated_at
  BEFORE UPDATE ON public.review_replies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- AUTOMATIC NEW USER ONBOARDING TRIGGER
-- Automatically provisions profile + workspace + owner membership for every new user
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_ws_id uuid;
  user_name text;
BEGIN
  user_name := COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  
  -- 1. Insert Profile
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, user_name)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  -- 2. Create Default Workspace
  INSERT INTO public.workspaces (name, created_by)
  VALUES (user_name || '''s Workspace', new.id)
  RETURNING id INTO new_ws_id;

  -- 3. Assign User as Owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws_id, new.id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing users who were created prior to this migration
DO $$
DECLARE
  r RECORD;
  ws_id uuid;
  u_name text;
BEGIN
  FOR r IN SELECT id, email, raw_user_meta_data FROM auth.users LOOP
    u_name := COALESCE(r.raw_user_meta_data->>'full_name', split_part(r.email, '@', 1));
    
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (r.id, r.email, u_name)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = r.id) THEN
      INSERT INTO public.workspaces (name, created_by)
      VALUES (u_name || '''s Workspace', r.id)
      RETURNING id INTO ws_id;

      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (ws_id, r.id, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- RLS SECURITY DEFINER HELPER FUNCTIONS (Avoid recursion in policies)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid, check_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = check_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(ws_id uuid, required_roles text[], check_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = check_user_id
      AND role = ANY(required_roles)
  );
$$;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_replies ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- 1. PROFILES POLICIES
DROP POLICY IF EXISTS "Users can view profile of self and workspace peers" ON public.profiles;
CREATE POLICY "Users can view profile of self and workspace peers"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.workspace_members wm1
      JOIN public.workspace_members wm2 ON wm1.workspace_id = wm2.workspace_id
      WHERE wm1.user_id = auth.uid() AND wm2.user_id = profiles.id
    )
  );

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2. WORKSPACES POLICIES
DROP POLICY IF EXISTS "Members can view workspaces" ON public.workspaces;
CREATE POLICY "Members can view workspaces"
  ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON public.workspaces;
CREATE POLICY "Authenticated users can create workspaces"
  ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Admins and owners can update workspace" ON public.workspaces;
CREATE POLICY "Admins and owners can update workspace"
  ON public.workspaces FOR UPDATE TO authenticated
  USING (public.has_workspace_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Owners can delete workspace" ON public.workspaces;
CREATE POLICY "Owners can delete workspace"
  ON public.workspaces FOR DELETE TO authenticated
  USING (public.has_workspace_role(id, ARRAY['owner']));

-- 3. WORKSPACE MEMBERS POLICIES
DROP POLICY IF EXISTS "Members can view workspace members" ON public.workspace_members;
CREATE POLICY "Members can view workspace members"
  ON public.workspace_members FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can invite members" ON public.workspace_members;
CREATE POLICY "Admins and owners can invite members"
  ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
    OR (auth.uid() = user_id AND role = 'owner')
  );

DROP POLICY IF EXISTS "Owners can update member role" ON public.workspace_members;
CREATE POLICY "Owners can update member role"
  ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner']));

DROP POLICY IF EXISTS "Admins can remove members or user can leave" ON public.workspace_members;
CREATE POLICY "Admins can remove members or user can leave"
  ON public.workspace_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid() OR
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin'])
  );

-- 4. LOCATIONS POLICIES
DROP POLICY IF EXISTS "Members can view locations" ON public.locations;
CREATE POLICY "Members can view locations"
  ON public.locations FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can insert locations" ON public.locations;
CREATE POLICY "Admins and owners can insert locations"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can update locations" ON public.locations;
CREATE POLICY "Admins and owners can update locations"
  ON public.locations FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS "Admins and owners can delete locations" ON public.locations;
CREATE POLICY "Admins and owners can delete locations"
  ON public.locations FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- 5. REVIEWS POLICIES
DROP POLICY IF EXISTS "Members can view reviews" ON public.reviews;
CREATE POLICY "Members can view reviews"
  ON public.reviews FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can insert reviews" ON public.reviews;
CREATE POLICY "Members can insert reviews"
  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can update reviews" ON public.reviews;
CREATE POLICY "Members can update reviews"
  ON public.reviews FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can delete reviews" ON public.reviews;
CREATE POLICY "Admins and owners can delete reviews"
  ON public.reviews FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- 6. REVIEW REPLIES POLICIES
DROP POLICY IF EXISTS "Members can view replies" ON public.review_replies;
CREATE POLICY "Members can view replies"
  ON public.review_replies FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members can insert replies" ON public.review_replies;
CREATE POLICY "Members can insert replies"
  ON public.review_replies FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS "Members can update replies" ON public.review_replies;
CREATE POLICY "Members can update replies"
  ON public.review_replies FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins and owners can delete replies" ON public.review_replies;
CREATE POLICY "Admins and owners can delete replies"
  ON public.review_replies FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- ============================================================================
-- PERFORMANCE INDEXES ON FOREIGN KEYS & QUERY COLUMNS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON public.workspaces(created_by);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_locations_workspace_id ON public.locations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reviews_workspace_id ON public.reviews(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reviews_location_id ON public.reviews(location_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews(status);
CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON public.review_replies(review_id);
CREATE INDEX IF NOT EXISTS idx_review_replies_workspace_id ON public.review_replies(workspace_id);
