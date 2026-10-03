import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import type { AppLifecycleState, LifecycleAdapter, LifecycleListener } from './browser-lifecycle';

interface NativeAppLifecycleSource {
  getState(): Promise<{ isActive: boolean }>;
  addListener(eventName: 'appStateChange', listener: (state: { isActive: boolean }) => void): Promise<PluginListenerHandle>;
}

export function createNativeLifecycleAdapter(source: NativeAppLifecycleSource = App): LifecycleAdapter {
  let currentState: AppLifecycleState = 'ACTIVE';
  void source.getState().then((state) => {
    currentState = state.isActive ? 'ACTIVE' : 'INACTIVE';
  });

  return {
    getCurrentState: () => currentState,
    subscribe(listener: LifecycleListener) {
      let disposed = false;
      let handle: PluginListenerHandle | null = null;
      void source.addListener('appStateChange', (state) => {
        currentState = state.isActive ? 'ACTIVE' : 'INACTIVE';
        listener(currentState);
      }).then((listenerHandle) => {
        if (disposed) void listenerHandle.remove();
        else handle = listenerHandle;
      });
      return () => {
        disposed = true;
        if (handle) void handle.remove();
      };
    },
  };
}
