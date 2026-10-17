ALTER TABLE public.mobile_push_devices
  DROP CONSTRAINT IF EXISTS mobile_push_devices_platform_check;

ALTER TABLE public.mobile_push_devices
  ADD CONSTRAINT mobile_push_devices_platform_check CHECK (platform IN ('ANDROID', 'IOS'));
