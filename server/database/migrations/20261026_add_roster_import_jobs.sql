CREATE TABLE IF NOT EXISTS public.roster_import_jobs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  chain_hash TEXT NOT NULL DEFAULT '',
  total_rows BIGINT NOT NULL CHECK(total_rows > 0),
  next_batch INTEGER NOT NULL DEFAULT 0 CHECK(next_batch >= 0),
  processed BIGINT NOT NULL DEFAULT 0,
  added BIGINT NOT NULL DEFAULT 0,
  skipped BIGINT NOT NULL DEFAULT 0,
  invalid BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING','COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(processed = added + skipped + invalid AND processed <= total_rows),
  CHECK(status <> 'COMPLETED' OR processed = total_rows)
);
CREATE TABLE IF NOT EXISTS public.roster_import_batches (
  job_id TEXT NOT NULL REFERENCES public.roster_import_jobs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL CHECK(batch_index >= 0),
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(job_id,batch_index)
);

-- Also harden an existing draft schema. CREATE TABLE IF NOT EXISTS alone does
-- not add constraints to tables created by an earlier version of this draft.
-- Existing invalid values must fail validation; never silently repair counters.
DO $$
DECLARE rule RECORD;
BEGIN
 FOR rule IN SELECT * FROM (VALUES
  ('roster_import_jobs', 'roster_import_jobs_processed_nonnegative', 'processed >= 0'),
  ('roster_import_jobs', 'roster_import_jobs_added_nonnegative', 'added >= 0'),
  ('roster_import_jobs', 'roster_import_jobs_skipped_nonnegative', 'skipped >= 0'),
  ('roster_import_jobs', 'roster_import_jobs_invalid_nonnegative', 'invalid >= 0'),
  ('roster_import_jobs', 'roster_import_jobs_chain_hash_format', 'chain_hash = '''' OR chain_hash ~ ''^[a-f0-9]{64}$'''),
  ('roster_import_batches', 'roster_import_batches_payload_hash_format', 'payload_hash ~ ''^[a-f0-9]{64}$''')
 ) AS rules(table_name, constraint_name, expression)
 LOOP
  IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid = format('public.%I', rule.table_name)::regclass
     AND conname = rule.constraint_name
  ) THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)',
    rule.table_name, rule.constraint_name, rule.expression);
  END IF;
 END LOOP;
END $$;

ALTER TABLE public.roster_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_import_batches ENABLE ROW LEVEL SECURITY;
-- FORCE is intentionally not enabled: postgres.ts connects using the role from
-- DATABASE_URL, without SET ROLE service_role. FORCE blocks a table owner that
-- has neither BYPASSRLS nor an applicable policy. Verify the actual backend
-- role/attributes before enabling it; do not grant a wider policy as a workaround.

DROP POLICY IF EXISTS "Backend service roster imports" ON public.roster_import_jobs;
CREATE POLICY "Backend service roster imports" ON public.roster_import_jobs
 FOR ALL TO service_role USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS "Backend service roster batches" ON public.roster_import_batches;
CREATE POLICY "Backend service roster batches" ON public.roster_import_batches
 FOR ALL TO service_role USING(true) WITH CHECK(true);

-- Supabase projects can grant browser roles privileges through default ACLs.
-- Revoke table AND legacy column grants; RLS is an additional boundary.
DO $$
DECLARE table_name TEXT; role_name TEXT; columns TEXT; grantee TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['roster_import_jobs','roster_import_batches'] LOOP
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
   FROM pg_attribute WHERE attrelid = format('public.%I', table_name)::regclass
    AND attnum > 0 AND NOT attisdropped;
  FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
   IF role_name = 'PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    grantee := CASE WHEN role_name = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %s', table_name, grantee);
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %s', columns, table_name, grantee);
   END IF;
  END LOOP;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
  -- Do not silently accept inherited/owner/superuser browser access. Fixing
  -- project-wide role membership is outside this table migration's authority.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    IF has_table_privilege(role_name, format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(role_name, format('public.%I', table_name), 'SELECT,INSERT,UPDATE,REFERENCES') THEN
     RAISE EXCEPTION 'Unexpected browser-role access to roster import tables; review role ownership and inheritance.';
    END IF;
   END IF;
  END LOOP;
 END LOOP;
END $$;

-- No automatic expiry: RUNNING jobs support resume; COMPLETED jobs and their
-- batches preserve replay protection and error reports. Retention/compaction
-- requires a separate policy that keeps idempotency tombstones. School deletion
-- continues to remove its jobs and batches through the existing foreign keys.
