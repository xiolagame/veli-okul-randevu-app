-- Keep the iOS registration fence atomic on production PostgreSQL and local PGlite.
-- Local migrations run alphabetically: the ANDROID-only platform check is widened later.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.mobile_push_devices IN ACCESS EXCLUSIVE MODE;

DO $migration$
DECLARE
  platform_check text;
  existing_columns integer;
  valid_columns integer;
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'notification_deliveries is missing';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO platform_check
  FROM pg_constraint AS c
  WHERE c.conrelid = 'public.mobile_push_devices'::regclass
    AND c.conname = 'mobile_push_devices_platform_check'
    AND c.contype = 'c';

  IF platform_check IS DISTINCT FROM $android$CHECK ((platform = 'ANDROID'::text))$android$
    AND platform_check IS DISTINCT FROM $ios$CHECK ((platform = ANY (ARRAY['ANDROID'::text, 'IOS'::text])))$ios$ THEN
    RAISE EXCEPTION 'Unexpected mobile_push_devices platform check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint AS c
    WHERE c.conrelid = 'public.mobile_push_devices'::regclass
      AND c.conname = 'mobile_push_devices_installation_id_key'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE (installation_id)'
  ) THEN
    RAISE EXCEPTION 'The installation_id unique constraint is missing';
  END IF;

  SELECT COUNT(*) INTO existing_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mobile_push_devices'
    AND column_name IN ('registration_generation', 'revoked_through_generation');

  IF existing_columns = 0 THEN
    EXECUTE 'ALTER TABLE public.mobile_push_devices
      ADD COLUMN registration_generation BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN revoked_through_generation BIGINT NOT NULL DEFAULT 0';
  ELSIF existing_columns <> 2 THEN
    RAISE EXCEPTION 'iOS registration generation columns are only partially present';
  END IF;

  SELECT COUNT(*) INTO valid_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mobile_push_devices'
    AND column_name IN ('registration_generation', 'revoked_through_generation')
    AND data_type = 'bigint' AND is_nullable = 'NO'
    AND column_default IN ('0', '0::bigint', '''0''::bigint', '0::int8', '''0''::int8');

  IF valid_columns <> 2 THEN
    RAISE EXCEPTION 'Unexpected iOS registration generation column definition';
  END IF;
END
$migration$;

COMMIT;
