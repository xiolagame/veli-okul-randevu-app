export const AUTH_TOKEN_STORAGE_KEY = 'veli_auth_token';

export interface AuthTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): WebStorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function createWebAuthTokenStore(storage?: WebStorageLike | null): AuthTokenStore {
  const resolveStorage = () => storage === undefined ? getBrowserStorage() : storage;

  return {
    async get() {
      return resolveStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
    },
    async set(token) {
      resolveStorage()?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    },
    async remove() {
      resolveStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    },
  };
}

export const webAuthTokenStore = createWebAuthTokenStore();
