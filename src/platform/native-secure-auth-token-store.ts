import { AUTH_TOKEN_STORAGE_KEY, AuthTokenStore, WebStorageLike } from './auth-token-store';

export const NATIVE_AUTH_TOKEN_KEY = 'veli_randevu_auth_token';

export interface SecureStringStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class SecureAuthStorageError extends Error {
  constructor() {
    super('Güvenli oturuma erişilemiyor. Lütfen tekrar deneyin.');
    this.name = 'SecureAuthStorageError';
  }
}

function getLegacyStorage(): WebStorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function createNativeSecureAuthTokenStore(
  secureStorage: SecureStringStore,
  legacyStorage?: WebStorageLike | null,
): AuthTokenStore {
  const resolveLegacyStorage = () => legacyStorage === undefined ? getLegacyStorage() : legacyStorage;
  const removeSecureAfterFailedWrite = async () => {
    try {
      await secureStorage.removeItem(NATIVE_AUTH_TOKEN_KEY);
    } catch {
    }
  };

  return {
    async get() {
      try {
        const secureToken = await secureStorage.getItem(NATIVE_AUTH_TOKEN_KEY);
        if (secureToken !== null) {
          resolveLegacyStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
          return secureToken;
        }

        const legacyToken = resolveLegacyStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
        if (legacyToken === null) return null;
        try {
          await secureStorage.setItem(NATIVE_AUTH_TOKEN_KEY, legacyToken);
          if (await secureStorage.getItem(NATIVE_AUTH_TOKEN_KEY) !== legacyToken) throw new SecureAuthStorageError();
        } catch {
          await removeSecureAfterFailedWrite();
          throw new SecureAuthStorageError();
        }
        resolveLegacyStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
        return legacyToken;
      } catch {
        throw new SecureAuthStorageError();
      }
    },
    async set(token) {
      try {
        await secureStorage.setItem(NATIVE_AUTH_TOKEN_KEY, token);
        if (await secureStorage.getItem(NATIVE_AUTH_TOKEN_KEY) !== token) throw new SecureAuthStorageError();
        resolveLegacyStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
      } catch {
        await removeSecureAfterFailedWrite();
        throw new SecureAuthStorageError();
      }
    },
    async remove() {
      try {
        await secureStorage.removeItem(NATIVE_AUTH_TOKEN_KEY);
        if (await secureStorage.getItem(NATIVE_AUTH_TOKEN_KEY) !== null) throw new SecureAuthStorageError();
      } catch {
        resolveLegacyStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
        throw new SecureAuthStorageError();
      }
      resolveLegacyStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    },
  };
}
