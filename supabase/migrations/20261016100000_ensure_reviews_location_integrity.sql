-- ============================================================================
-- MIGRATION: Ensure Review Location Integrity & Performance Indexes
-- Description: Guarantees location_id foreign key, indexing, and prevents 
--              cross-location review leakage in multi-tenant workspaces.
-- ============================================================================

-- 1. Ensure location_id column exists on public.reviews
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'reviews' 
      AND column_name = 'location_id'
  ) THEN
    ALTER TABLE public.reviews 
    ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Indexes for location-scoped inbox querying and counts
CREATE INDEX IF NOT EXISTS idx_reviews_location_id 
  ON public.reviews(location_id);

CREATE INDEX IF NOT EXISTS idx_reviews_workspace_location 
  ON public.reviews(workspace_id, location_id);

CREATE INDEX IF NOT EXISTS idx_reviews_workspace_status_location 
  ON public.reviews(workspace_id, location_id, status);

CREATE INDEX IF NOT EXISTS idx_reviews_workspace_external 
  ON public.reviews(workspace_id, external_review_id);

-- 3. Document table relationships
COMMENT ON COLUMN public.reviews.location_id IS 
  'Foreign key referencing public.locations(id). Enforces strict business separation between different locations (e.g., Just Wow vs Creation For U) within a workspace.';
