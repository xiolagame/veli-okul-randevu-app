-- Randevu iptali: isteğe bağlı iptal gerekçesi ve iptal push bildirimleri.
-- Yalnız ekleme yapar; mevcut randevu ve bildirim satırları değiştirilmez. Tekrar çalıştırılabilir.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_event_type_check;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_event_type_check
  CHECK (event_type IN ('APPOINTMENT_REQUESTED', 'APPOINTMENT_APPROVED', 'APPOINTMENT_REJECTED',
    'APPOINTMENT_CANCELLED_FOR_PARENT', 'APPOINTMENT_CANCELLED_FOR_TEACHER'));
