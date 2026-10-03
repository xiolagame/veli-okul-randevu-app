import { AuthTokenStore, WebStorageLike, webAuthTokenStore } from './auth-token-store';
import { createNativeSecureAuthTokenStore, SecureStringStore } from './native-secure-auth-token-store';
import { getRuntimePlatform, RuntimePlatform } from './runtime-platform';

const nativeSecureStorage: SecureStringStore = {
  async getItem(key) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    return SecureStorage.getItem(key);
  },
  async setItem(key, value) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.setItem(key, value);
  },
  async removeItem(key) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.removeItem(key);
  },
};

export function selectAuthTokenStore(
  platform: RuntimePlatform,
  nativeStorage: SecureStringStore = nativeSecureStorage,
  legacyStorage?: WebStorageLike | null,
): AuthTokenStore {
  return platform === 'WEB'
    ? webAuthTokenStore
    : createNativeSecureAuthTokenStore(nativeStorage, legacyStorage);
}

export const runtimeAuthTokenStore = selectAuthTokenStore(getRuntimePlatform());
