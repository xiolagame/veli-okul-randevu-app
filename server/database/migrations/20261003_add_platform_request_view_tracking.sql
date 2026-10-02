CREATE TABLE IF NOT EXISTS public.platform_admin_request_views (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  requests_last_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_requests_visible_created_at
  ON public.platform_requests (created_at)
  WHERE platform_hidden_at IS NULL;

ALTER TABLE public.platform_admin_request_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_admin_request_views'
      AND policyname = 'Express backend service full access platform_admin_request_views'
  ) THEN
    CREATE POLICY "Express backend service full access platform_admin_request_views"
      ON public.platform_admin_request_views FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
