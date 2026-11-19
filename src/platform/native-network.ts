import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import type { NetworkConnectivityHint, NetworkHintAdapter, NetworkHintListener } from './browser-network';

interface NativeNetworkSource {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(eventName: 'networkStatusChange', listener: (status: { connected: boolean }) => void): Promise<PluginListenerHandle>;
}

export function createNativeNetworkAdapter(source: NativeNetworkSource = Network): NetworkHintAdapter {
  let currentHint: NetworkConnectivityHint = 'CONNECTED';
  let receivedEvent = false;
  const listeners = new Set<NetworkHintListener>();
  void source.getStatus().then((status) => {
    if (receivedEvent) return;
    currentHint = status.connected ? 'CONNECTED' : 'DISCONNECTED';
    for (const listener of listeners) listener(currentHint);
  }).catch(() => {});

  return {
    getCurrentHint: () => currentHint,
    subscribe(listener: NetworkHintListener) {
      let disposed = false;
      let handle: PluginListenerHandle | null = null;
      listeners.add(listener);
      void source.addListener('networkStatusChange', (status) => {
        if (disposed) return;
        receivedEvent = true;
        currentHint = status.connected ? 'CONNECTED' : 'DISCONNECTED';
        listener(currentHint);
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
