-- Additive revision of the unpublished license reminder draft. No automatic sends.
ALTER TABLE public.school_license_reminder_recipients DROP CONSTRAINT IF EXISTS school_license_reminder_recipients_pkey;
ALTER TABLE public.school_license_reminder_recipients ADD PRIMARY KEY(school_id,user_id);
CREATE TABLE IF NOT EXISTS public.school_license_reminder_operations (
 id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 license_id TEXT NOT NULL REFERENCES school_licenses(id) ON DELETE CASCADE,
 actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_auth_version INTEGER NOT NULL,
 snapshot_hash TEXT NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 period_hash TEXT NOT NULL CHECK(period_hash ~ '^[a-f0-9]{64}$'),reminder_days INTEGER NOT NULL CHECK(reminder_days>=0),
 live_preview BOOLEAN NOT NULL,status TEXT NOT NULL CHECK(status IN ('PREVIEW','QUEUED','COMPLETED','TEST','INVALIDATED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,confirmed_at TIMESTAMPTZ
);
ALTER TABLE public.school_license_reminder_operations ADD COLUMN IF NOT EXISTS target_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(target_keys)='array');
ALTER TABLE public.school_license_reminder_operations ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 0 CHECK(recipient_count>=0);
ALTER TABLE public.school_license_reminder_operations ADD COLUMN IF NOT EXISTS last_wake_at TIMESTAMPTZ;
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'AUTO' CHECK(source IN ('AUTO','MANUAL'));
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS operation_id TEXT REFERENCES school_license_reminder_operations(id) ON DELETE SET NULL;
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS destination_key TEXT;
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS masked_phone TEXT;
ALTER TABLE public.school_license_reminder_attempts ADD COLUMN IF NOT EXISTS reason TEXT;
-- Deleted administrators must not erase phone-level duplicate-prevention tombstones.
ALTER TABLE public.school_license_reminder_attempts ALTER COLUMN recipient_id DROP NOT NULL;
ALTER TABLE public.school_license_reminder_attempts DROP CONSTRAINT IF EXISTS school_license_reminder_attempts_recipient_id_fkey;
ALTER TABLE public.school_license_reminder_attempts ADD CONSTRAINT school_license_reminder_attempts_recipient_id_fkey FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE SET NULL;
-- Preserve all legacy tombstones; never recreate a send because a column changed.
UPDATE public.school_license_reminder_attempts SET destination_key=phone_fingerprint WHERE destination_key IS NULL;
ALTER TABLE public.school_license_reminder_attempts ALTER COLUMN destination_key SET NOT NULL;
DO $$ DECLARE c RECORD; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.school_license_reminder_attempts'::regclass
  AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (school_id, license_id, period_hash, reminder_days)' LOOP
  EXECUTE format('ALTER TABLE school_license_reminder_attempts DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.school_license_reminder_attempts DROP CONSTRAINT IF EXISTS school_license_reminder_attempts_reminder_days_check;
ALTER TABLE public.school_license_reminder_attempts ADD CONSTRAINT school_license_reminder_attempts_reminder_days_check CHECK(reminder_days>=0);
ALTER TABLE public.school_license_reminder_attempts DROP CONSTRAINT IF EXISTS school_license_reminder_attempts_status_check;
ALTER TABLE public.school_license_reminder_attempts ADD CONSTRAINT school_license_reminder_attempts_status_check
 CHECK(status IN ('DISPATCHING','ACCEPTED','REJECTED','UNKNOWN','CONFIG_UNAVAILABLE','DISABLED','INVALIDATED','SKIPPED'));
CREATE UNIQUE INDEX IF NOT EXISTS license_reminder_auto_destination ON school_license_reminder_attempts(school_id,license_id,period_hash,reminder_days,destination_key) WHERE source='AUTO';
CREATE UNIQUE INDEX IF NOT EXISTS license_reminder_manual_destination ON school_license_reminder_attempts(operation_id,destination_key) WHERE source='MANUAL';
CREATE TABLE IF NOT EXISTS public.school_license_reminder_cooldowns (
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,destination_key TEXT NOT NULL CHECK(destination_key ~ '^[a-f0-9]{64}$'),
 reserved_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(school_id,destination_key)
);
ALTER TABLE school_license_reminder_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_license_reminder_cooldowns ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE tbl TEXT; role_name TEXT; columns TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['school_license_reminder_operations','school_license_reminder_cooldowns'] LOOP
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

CREATE INDEX IF NOT EXISTS license_reminder_queued_operations ON school_license_reminder_operations(created_at) WHERE status='QUEUED';
