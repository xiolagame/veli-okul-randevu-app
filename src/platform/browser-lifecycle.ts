export type AppLifecycleState = 'ACTIVE' | 'INACTIVE';
export type LifecycleListener = (state: AppLifecycleState) => void;

interface BrowserLifecycleSource {
  visibilityState?: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface LifecycleAdapter {
  getCurrentState(): AppLifecycleState;
  subscribe(listener: LifecycleListener): () => void;
}

export function createBrowserLifecycleAdapter(
  source: BrowserLifecycleSource | null = typeof document === 'undefined' ? null : document,
): LifecycleAdapter {
  const getCurrentState = (): AppLifecycleState => source?.visibilityState === 'hidden' ? 'INACTIVE' : 'ACTIVE';

  return {
    getCurrentState,
    subscribe(listener) {
      if (!source) return () => {};
      const handleVisibilityChange = () => listener(getCurrentState());
      source.addEventListener('visibilitychange', handleVisibilityChange);
      return () => source.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}

export const browserLifecycle = createBrowserLifecycleAdapter();
