-- Öğretmenin müsaitlik bloğu için seçtiği görüşme süresi (dakika).
-- NULL = okulun standart süresi kullanılır (mevcut bütün kayıtlar böyle kalır).
-- Yalnız ekleme yapar; mevcut satırlar değiştirilmez.
ALTER TABLE public.availability_slots ADD COLUMN IF NOT EXISTS custom_duration_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'availability_slots_custom_duration_check'
  ) THEN
    ALTER TABLE public.availability_slots
      ADD CONSTRAINT availability_slots_custom_duration_check
      CHECK (custom_duration_minutes IS NULL OR custom_duration_minutes IN (20, 30, 40, 50, 60));
  END IF;
END $$;
