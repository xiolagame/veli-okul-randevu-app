export type NetworkConnectivityHint = 'CONNECTED' | 'DISCONNECTED';
export type NetworkHintListener = (state: NetworkConnectivityHint) => void;

interface BrowserNetworkSource {
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

interface BrowserNavigatorSource {
  onLine: boolean;
}

export interface NetworkHintAdapter {
  getCurrentHint(): NetworkConnectivityHint;
  subscribe(listener: NetworkHintListener): () => void;
}

export function createBrowserNetworkAdapter(
  source: BrowserNetworkSource | null = typeof window === 'undefined' ? null : window,
  navigatorSource: BrowserNavigatorSource | null = typeof navigator === 'undefined' ? null : navigator,
): NetworkHintAdapter {
  const getCurrentHint = (): NetworkConnectivityHint => navigatorSource?.onLine === false ? 'DISCONNECTED' : 'CONNECTED';

  return {
    getCurrentHint,
    subscribe(listener) {
      if (!source) return () => {};
      const handleChange = () => listener(getCurrentHint());
      source.addEventListener('online', handleChange);
      source.addEventListener('offline', handleChange);
      return () => {
        source.removeEventListener('online', handleChange);
        source.removeEventListener('offline', handleChange);
      };
    },
  };
}

export const browserNetwork = createBrowserNetworkAdapter();
