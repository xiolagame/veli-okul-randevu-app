import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { BackNavigationDecision, BackNavigationState, decideBackNavigation } from './back-navigation';
import { getRuntimePlatform } from './runtime-platform';

interface NativeBackSource {
  addListener(eventName: 'backButton', listener: (event: { canGoBack: boolean }) => void): Promise<PluginListenerHandle>;
  exitApp(): Promise<void>;
}

export function subscribeToNativeBackNavigation(
  getState: () => BackNavigationState,
  onDecision: (decision: BackNavigationDecision) => void,
  source: NativeBackSource = App,
  runtimePlatform = getRuntimePlatform,
  navigateBack = () => window.history.back(),
): () => void {
  if (runtimePlatform() !== 'ANDROID') return () => {};
  let disposed = false;
  let handle: PluginListenerHandle | null = null;
  void source.addListener('backButton', (event) => {
    const decision = decideBackNavigation(getState());
    if (decision !== 'DEFER_TO_NATIVE_SHELL') {
      onDecision(decision);
      return;
    }
    if (event.canGoBack) navigateBack();
    else void source.exitApp().catch(() => {});
  }).then((listenerHandle) => {
    if (disposed) void listenerHandle.remove();
    else handle = listenerHandle;
  }).catch(() => {});
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
