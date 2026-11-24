export type LoginEntry = 'loading' | 'error' | 'unavailable' | 'phone';

// No platform may guess an authentication form before capabilities are known.
// Giriş yalnız telefon numarası + WhatsApp koduyla yapılır; parola girişi yoktur.
export function resolveLoginEntry(status: 'loading' | 'ready' | 'error', phoneEnabled: boolean): LoginEntry {
  if (status !== 'ready') return status;
  return phoneEnabled ? 'phone' : 'unavailable';
}
