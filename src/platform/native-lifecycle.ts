import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import type { AppLifecycleState, LifecycleAdapter, LifecycleListener } from './browser-lifecycle';

interface NativeAppLifecycleSource {
  getState(): Promise<{ isActive: boolean }>;
  addListener(eventName: 'appStateChange', listener: (state: { isActive: boolean }) => void): Promise<PluginListenerHandle>;
}

export function createNativeLifecycleAdapter(source: NativeAppLifecycleSource = App): LifecycleAdapter {
  let currentState: AppLifecycleState = 'ACTIVE';
  let receivedEvent = false;
  const listeners = new Set<LifecycleListener>();
  void source.getState().then((state) => {
    if (receivedEvent) return;
    currentState = state.isActive ? 'ACTIVE' : 'INACTIVE';
    for (const listener of listeners) listener(currentState);
  }).catch(() => {});

  return {
    getCurrentState: () => currentState,
    subscribe(listener: LifecycleListener) {
      let disposed = false;
      let handle: PluginListenerHandle | null = null;
      listeners.add(listener);
      void source.addListener('appStateChange', (state) => {
        if (disposed) return;
        receivedEvent = true;
        currentState = state.isActive ? 'ACTIVE' : 'INACTIVE';
        listener(currentState);
      }).then((listenerHandle) => {
        if (disposed) void listenerHandle.remove().catch(() => {});
        else handle = listenerHandle;
      }).catch(() => {});
      return () => {
        disposed = true;
        listeners.delete(listener);
        if (handle) void handle.remove().catch(() => {});
      };
    },
  };
}
