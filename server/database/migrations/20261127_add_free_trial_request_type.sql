-- "1 Haftalık Ücretsiz Deneme" talep türü (yalnız web formu). Mevcut kayıtlar değişmez.
BEGIN;
ALTER TABLE public.platform_requests
  DROP CONSTRAINT IF EXISTS platform_requests_request_type_check;
ALTER TABLE public.platform_requests
  ADD CONSTRAINT platform_requests_request_type_check
  CHECK (request_type IN ('MONTHLY_LICENSE', 'YEARLY_LICENSE', 'FREE_TRIAL', 'CONTACT', 'SUPPORT'));
COMMIT;
