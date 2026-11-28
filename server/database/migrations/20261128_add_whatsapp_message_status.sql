-- WhatsApp doğrulama mesajlarının teslim durumu (Meta webhook bildirimleri).
-- Yalnızca platform yönetimi görür; kayıtlar 30 gün sonra silinir.
CREATE TABLE IF NOT EXISTS public.whatsapp_message_status (
  message_id VARCHAR(200) PRIMARY KEY,
  recipient_phone VARCHAR(20) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_code INTEGER,
  error_title VARCHAR(300),
  status_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_status_created_at
  ON public.whatsapp_message_status (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_status_phone
  ON public.whatsapp_message_status (recipient_phone, created_at DESC);

ALTER TABLE public.whatsapp_message_status ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_message_status'
      AND policyname = 'Express backend service full access whatsapp_message_status'
  ) THEN
    CREATE POLICY "Express backend service full access whatsapp_message_status"
      ON public.whatsapp_message_status FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
