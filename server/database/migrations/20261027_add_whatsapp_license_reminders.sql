-- Additive DRAFT. Apply only after separate production approval.
-- An authorized consent/provisioning process must populate the recipient table.
CREATE TABLE IF NOT EXISTS public.school_license_reminder_recipients (
  school_id TEXT PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_fingerprint TEXT NOT NULL CHECK (phone_fingerprint ~ '^[a-f0-9]{64}$'),
  consent_at TIMESTAMPTZ NOT NULL,
  consent_reference TEXT NOT NULL CHECK (length(btrim(consent_reference)) BETWEEN 1 AND 200),
  revoked_at TIMESTAMPTZ,
  UNIQUE(school_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.school_license_reminder_attempts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  license_id TEXT NOT NULL REFERENCES public.school_licenses(id) ON DELETE CASCADE,
  period_hash TEXT NOT NULL CHECK (period_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  reminder_days INTEGER NOT NULL CHECK (reminder_days IN (7,3,1)),
  recipient_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_fingerprint TEXT NOT NULL CHECK (phone_fingerprint ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('DISPATCHING','ACCEPTED','REJECTED','UNKNOWN','CONFIG_UNAVAILABLE','DISABLED','INVALIDATED')),
  delivery_status TEXT NOT NULL DEFAULT 'UNCONFIRMED' CHECK (delivery_status IN ('UNCONFIRMED','DELIVERED','FAILED')),
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  -- Stronger than per-recipient dedupe: changing the selected admin/phone cannot
  -- cause a second message for the same school/period/milestone.
  UNIQUE(school_id,license_id,period_hash,reminder_days)
);
CREATE INDEX IF NOT EXISTS license_reminder_attempt_school_idx ON public.school_license_reminder_attempts(school_id,created_at);
ALTER TABLE public.school_license_reminder_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_license_reminder_attempts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE tbl TEXT; role_name TEXT; columns TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['school_license_reminder_recipients','school_license_reminder_attempts'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tbl);
    SELECT string_agg(quote_ident(attname),', ') INTO columns FROM pg_attribute
      WHERE attrelid=format('public.%I',tbl)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC',columns,tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I',tbl,role_name);
        EXECUTE format('REVOKE ALL (%s) ON public.%I FROM %I',columns,tbl,role_name);
        IF has_table_privilege(role_name,format('public.%I',tbl),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(role_name,format('public.%I',tbl),'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'Unexpected inherited access to license reminder tables';
        END IF;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',tbl);
      IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname='license_reminder_backend') THEN
        EXECUTE format('CREATE POLICY license_reminder_backend ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',tbl);
      END IF;
    END IF;
  END LOOP;
END $$;
-- No automatic retry/TTL deletion: even DISPATCHING/UNKNOWN are durable
-- duplicate-prevention tombstones. Delivery requires verified Meta webhooks;
-- this migration never equates ACCEPTED with DELIVERED.
