import { registerPlugin } from '@capacitor/core';
import { getRuntimePlatform } from './runtime-platform';
import { currentTheme } from './theme';

const chrome = registerPlugin<{
  apply(options: { theme: 'light' | 'dark'; login: boolean }): Promise<void>;
}>('AndroidSystemBars');

let loginSurface = false;

function refresh() {
  if (getRuntimePlatform() !== 'ANDROID') return;
  // Native chrome must never delay authentication or expose session details.
  void chrome.apply({ theme: currentTheme(), login: loginSurface }).catch(() => {});
}

export function setAndroidLoginSurface(active: boolean) {
  loginSurface = active;
  refresh();
}

export function subscribeAndroidSystemBars() {
  if (getRuntimePlatform() !== 'ANDROID') return () => {};
  window.addEventListener('veli:theme', refresh);
  refresh();
  return () => window.removeEventListener('veli:theme', refresh);
}
