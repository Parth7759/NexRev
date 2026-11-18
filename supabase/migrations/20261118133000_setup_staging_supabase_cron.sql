-- Migration: 20261118133000_setup_staging_supabase_cron.sql
-- Description: Supabase Cron (pg_cron + pg_net + Vault) 1-minute dispatcher for NexRep Staging
--              scheduled reply worker, with overlap guard, HTTP diagnostics, and cron history pruning.
-- Target: STAGING ONLY (tbguitzuqyetvwughohp)
-- Security: ZERO secrets stored in SQL migration or cron.job plaintext. All credentials live in Supabase Vault.
-- Rollback policy: Unschedule cron jobs via cron.unschedule() and revert code ONLY;
--                  do NOT drop queue, health, or worker audit tables.

-- 1. Enable pg_cron and pg_net extensions idempotently
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Service-role-only RPC to store/update worker URL and dedicated secret in Supabase Vault
CREATE OR REPLACE FUNCTION public.upsert_worker_scheduler_vault_config(
  p_worker_url text,
  p_worker_secret text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_url_id uuid;
  v_secret_id uuid;
BEGIN
  IF p_worker_url IS NULL OR trim(p_worker_url) = '' OR left(trim(p_worker_url), 8) <> 'https://' THEN
    RAISE EXCEPTION 'Worker URL must be a valid https:// URL';
  END IF;

  IF p_worker_secret IS NULL OR length(trim(p_worker_secret)) < 32 THEN
    RAISE EXCEPTION 'Worker secret must be at least 32 characters long';
  END IF;

  -- Upsert staging worker URL in Vault
  SELECT id INTO v_url_id FROM vault.secrets WHERE name = 'nexrep_staging_worker_url' LIMIT 1;
  IF v_url_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_url_id, trim(p_worker_url), 'nexrep_staging_worker_url', 'NexRep Staging scheduled reply worker endpoint URL');
  ELSE
    PERFORM vault.create_secret(trim(p_worker_url), 'nexrep_staging_worker_url', 'NexRep Staging scheduled reply worker endpoint URL');
  END IF;

  -- Upsert dedicated high-entropy worker secret in Vault (never SUPABASE_SERVICE_ROLE_KEY)
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'nexrep_staging_worker_secret' LIMIT 1;
  IF v_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_secret_id, trim(p_worker_secret), 'nexrep_staging_worker_secret', 'NexRep Staging dedicated worker Bearer secret');
  ELSE
    PERFORM vault.create_secret(trim(p_worker_secret), 'nexrep_staging_worker_secret', 'NexRep Staging dedicated worker Bearer secret');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'url_configured', true,
    'secret_configured', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_worker_scheduler_vault_config(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_worker_scheduler_vault_config(text, text)
  TO service_role;

-- 3. Secure 1-minute dispatcher function (reads Vault dynamically, prevents overlaps, 30s timeout)
CREATE OR REPLACE FUNCTION public.dispatch_staging_scheduled_reply_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, vault
AS $$
DECLARE
  v_worker_url text;
  v_worker_secret text;
  v_active_run_exists boolean;
  v_request_id bigint;
BEGIN
  -- Overlap guard: skip dispatch if a worker run is actively running within the last 90 seconds
  SELECT EXISTS (
    SELECT 1
    FROM public.automation_worker_runs
    WHERE status = 'running'
      AND started_at > now() - interval '90 seconds'
  ) INTO v_active_run_exists;

  IF v_active_run_exists THEN
    RETURN NULL;
  END IF;

  -- Read URL and dedicated secret dynamically from Supabase Vault (never stored in cron.job)
  SELECT decrypted_secret INTO v_worker_url
  FROM vault.decrypted_secrets
  WHERE name = 'nexrep_staging_worker_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'nexrep_staging_worker_secret'
  LIMIT 1;

  -- Fail-safe: do nothing if Vault config has not been seeded yet
  IF v_worker_url IS NULL OR trim(v_worker_url) = '' OR v_worker_secret IS NULL OR trim(v_worker_secret) = '' THEN
    RETURN NULL;
  END IF;

  -- Dispatch async HTTPS POST via pg_net with 30-second timeout
  SELECT net.http_post(
    url := trim(v_worker_url),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim(v_worker_secret),
      'x-nexrep-scheduler-source', 'supabase_cron'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_staging_scheduled_reply_worker()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_staging_scheduled_reply_worker()
  TO service_role;

-- 4. Safe cron history pruning (prunes ONLY internal pg_cron logs > 7 days; preserves all application audit tables)
CREATE OR REPLACE FUNCTION public.cleanup_staging_cron_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM cron.job_run_details
  WHERE end_time < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_staging_cron_history()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_staging_cron_history()
  TO service_role;

-- 5. Read-only service_role diagnostic RPC (never exposes secret values)
CREATE OR REPLACE FUNCTION public.get_staging_cron_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net, vault
AS $$
DECLARE
  v_extensions jsonb;
  v_jobs jsonb;
  v_runs jsonb;
  v_http jsonb;
  v_url_present boolean;
  v_secret_present boolean;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', extname,
    'version', extversion
  ) ORDER BY extname), '[]'::jsonb)
  INTO v_extensions
  FROM pg_extension
  WHERE extname IN ('pg_cron', 'pg_net', 'supabase_vault');

  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nexrep_staging_worker_url')
    INTO v_url_present;
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nexrep_staging_worker_secret')
    INTO v_secret_present;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'jobname', jobname,
    'schedule', schedule,
    'command', command,
    'active', active
  ) ORDER BY jobid), '[]'::jsonb)
  INTO v_jobs
  FROM cron.job;

  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
  INTO v_runs
  FROM (
    SELECT runid, jobid, status, return_message, start_time, end_time
    FROM cron.job_run_details
    ORDER BY start_time DESC
    LIMIT 10
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(h)::jsonb), '[]'::jsonb)
  INTO v_http
  FROM (
    SELECT id, status_code, error_msg, timed_out, created
    FROM net._http_response
    ORDER BY created DESC
    LIMIT 10
  ) h;

  RETURN jsonb_build_object(
    'extensions', v_extensions,
    'vault_configured', jsonb_build_object(
      'url_present', v_url_present,
      'secret_present', v_secret_present
    ),
    'cron_jobs', v_jobs,
    'recent_cron_runs', v_runs,
    'recent_http_responses', v_http
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_staging_cron_diagnostics()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_staging_cron_diagnostics()
  TO service_role;

-- 6. Idempotent scheduling (prevents duplicate schedules on re-run)
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('nexrep-staging-reply-worker', 'nexrep-staging-cron-history-cleanup')
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'nexrep-staging-reply-worker',
    '* * * * *',
    'SELECT public.dispatch_staging_scheduled_reply_worker();'
  );

  PERFORM cron.schedule(
    'nexrep-staging-cron-history-cleanup',
    '15 3 * * *',
    'SELECT public.cleanup_staging_cron_history();'
  );
END;
$$;
