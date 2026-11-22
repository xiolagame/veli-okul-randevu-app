CREATE TABLE IF NOT EXISTS public.platform_pricing (
  plan_code VARCHAR(30) PRIMARY KEY CHECK (plan_code IN ('YEARLY_LICENSE')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  currency CHAR(3) NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_pricing ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_pricing'
      AND policyname = 'Express backend service full access platform_pricing'
  ) THEN
    CREATE POLICY "Express backend service full access platform_pricing"
      ON public.platform_pricing FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 9.900,00 TL = 990000 kuruş. Mevcut satır varsa değiştirilmez.
INSERT INTO public.platform_pricing (plan_code, amount_minor, currency)
VALUES ('YEARLY_LICENSE', 990000, 'TRY')
ON CONFLICT (plan_code) DO NOTHING;
