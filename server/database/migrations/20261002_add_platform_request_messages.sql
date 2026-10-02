ALTER TABLE public.platform_requests
  ADD COLUMN IF NOT EXISTS school_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_hidden_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.platform_request_messages (
  id TEXT PRIMARY KEY DEFAULT ('prm-' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
  request_id TEXT NOT NULL REFERENCES public.platform_requests(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  sender_kind VARCHAR(20) NOT NULL CHECK (sender_kind IN ('SCHOOL_ADMIN', 'PLATFORM_ADMIN')),
  sender_name_snapshot VARCHAR(150) NOT NULL,
  message VARCHAR(4000) NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  idempotency_key UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_request_messages_request_created_at
  ON public.platform_request_messages (request_id, created_at, id);

ALTER TABLE public.platform_request_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_request_messages'
      AND policyname = 'Express backend service full access platform_request_messages'
  ) THEN
    CREATE POLICY "Express backend service full access platform_request_messages"
      ON public.platform_request_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
