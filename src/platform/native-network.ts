import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import type { NetworkConnectivityHint, NetworkHintAdapter, NetworkHintListener } from './browser-network';

interface NativeNetworkSource {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(eventName: 'networkStatusChange', listener: (status: { connected: boolean }) => void): Promise<PluginListenerHandle>;
}

export function createNativeNetworkAdapter(source: NativeNetworkSource = Network): NetworkHintAdapter {
  let currentHint: NetworkConnectivityHint = 'CONNECTED';
  void source.getStatus().then((status) => {
    currentHint = status.connected ? 'CONNECTED' : 'DISCONNECTED';
  });

  return {
    getCurrentHint: () => currentHint,
    subscribe(listener: NetworkHintListener) {
      let disposed = false;
      let handle: PluginListenerHandle | null = null;
      void source.addListener('networkStatusChange', (status) => {
        currentHint = status.connected ? 'CONNECTED' : 'DISCONNECTED';
        listener(currentHint);
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
