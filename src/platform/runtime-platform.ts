import { Capacitor } from '@capacitor/core';

export type RuntimePlatform = 'WEB' | 'ANDROID' | 'IOS';

export function getRuntimePlatform(): RuntimePlatform {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') return 'ANDROID';
  if (platform === 'ios') return 'IOS';
  return 'WEB';
}

export function isNativeRuntime(): boolean {
  return getRuntimePlatform() !== 'WEB';
}
