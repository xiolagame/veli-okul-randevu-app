import type { RuntimePlatform } from './runtime-platform';

export type LoginEntry = 'loading' | 'error' | 'unavailable' | 'phone' | 'legacy';

// No platform may guess an authentication form before capabilities are known.
export function resolveLoginEntry(platform: RuntimePlatform, status: 'loading' | 'ready' | 'error', phoneEnabled: boolean, passwordSelected: boolean): LoginEntry {
  if (status !== 'ready') return status;
  if (platform !== 'ANDROID') {
    return phoneEnabled ? 'phone' : 'unavailable';
  }
  return phoneEnabled && !passwordSelected ? 'phone' : 'legacy';
}

export const allowLegacyPhoneFallback = (platform: RuntimePlatform): boolean => platform === 'ANDROID';
