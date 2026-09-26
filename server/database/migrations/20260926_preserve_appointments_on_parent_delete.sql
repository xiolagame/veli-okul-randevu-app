ALTER TABLE public.appointments ALTER COLUMN parent_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_parent_id_fkey'
      AND confdeltype <> 'n'
  ) THEN
    ALTER TABLE public.appointments DROP CONSTRAINT appointments_parent_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_parent_id_fkey'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
