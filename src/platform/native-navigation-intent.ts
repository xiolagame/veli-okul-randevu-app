import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { NavigationIntent, parseNavigationIntent, pendingNavigationIntent } from './navigation-intent';
import { isNativeRuntime } from './runtime-platform';

const CANONICAL_APP_LINK_ORIGIN = 'https://velirandevu.com';

interface NativeUrlSource {
  getLaunchUrl(): Promise<{ url: string } | undefined>;
  addListener(eventName: 'appUrlOpen', listener: (event: { url: string }) => void): Promise<PluginListenerHandle>;
}

export function subscribeToNativeNavigationIntents(
  onIntent?: (intent: NavigationIntent) => void,
  source: NativeUrlSource = App,
): () => void {
  if (!isNativeRuntime()) return () => {};
  let disposed = false;
  let receivedEvent = false;
  let handle: PluginListenerHandle | null = null;
  const accept = (url: string) => {
    if (disposed) return;
    const intent = parseNavigationIntent(url, CANONICAL_APP_LINK_ORIGIN);
    if (!intent) return;
    pendingNavigationIntent.set(intent);
    if (onIntent) onIntent(intent);
    else window.dispatchEvent(new Event('veli:navigation-intent'));
  };
  void source.getLaunchUrl().then((launch) => {
    if (!receivedEvent && launch) accept(launch.url);
  }).catch(() => {});
  void source.addListener('appUrlOpen', (event) => {
    if (parseNavigationIntent(event.url, CANONICAL_APP_LINK_ORIGIN)) receivedEvent = true;
    accept(event.url);
  }).then((listenerHandle) => {
    if (disposed) void listenerHandle.remove().catch(() => {});
    else handle = listenerHandle;
  }).catch(() => {});
  return () => {
    disposed = true;
    if (handle) void handle.remove().catch(() => {});
  };
}
