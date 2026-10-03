import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { BackNavigationDecision, BackNavigationState, decideBackNavigation } from './back-navigation';
import { getRuntimePlatform } from './runtime-platform';

interface NativeBackSource {
  addListener(eventName: 'backButton', listener: () => void): Promise<PluginListenerHandle>;
}

export function subscribeToNativeBackNavigation(
  getState: () => BackNavigationState,
  onDecision: (decision: BackNavigationDecision) => void,
  source: NativeBackSource = App,
): () => void {
  if (getRuntimePlatform() !== 'ANDROID') return () => {};
  let disposed = false;
  let handle: PluginListenerHandle | null = null;
  void source.addListener('backButton', () => onDecision(decideBackNavigation(getState()))).then((listenerHandle) => {
    if (disposed) void listenerHandle.remove();
    else handle = listenerHandle;
  });
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
