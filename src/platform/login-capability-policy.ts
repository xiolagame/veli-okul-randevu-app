import type { RuntimePlatform } from './runtime-platform';

export type LoginEntry = 'loading' | 'error' | 'unavailable' | 'phone' | 'legacy';

// iOS follows the production web contract. Android retains its existing rollout.
export function resolveLoginEntry(platform: RuntimePlatform, status: 'loading' | 'ready' | 'error', phoneEnabled: boolean, passwordSelected: boolean): LoginEntry {
  if (platform !== 'ANDROID') {
    if (status !== 'ready') return status;
    return phoneEnabled ? 'phone' : 'unavailable';
  }
  return phoneEnabled && !passwordSelected ? 'phone' : 'legacy';
}

export const allowLegacyPhoneFallback = (platform: RuntimePlatform): boolean => platform === 'ANDROID';
