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
  let handle: PluginListenerHandle | null = null;
  const accept = (url: string) => {
    const intent = parseNavigationIntent(url, CANONICAL_APP_LINK_ORIGIN);
    if (!intent) return;
    pendingNavigationIntent.set(intent);
    onIntent?.(intent);
  };
  void source.getLaunchUrl().then((launch) => {
    if (!disposed && launch) accept(launch.url);
  });
  void source.addListener('appUrlOpen', (event) => accept(event.url)).then((listenerHandle) => {
    if (disposed) void listenerHandle.remove();
    else handle = listenerHandle;
  });
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
