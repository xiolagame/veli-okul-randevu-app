import assert from 'node:assert/strict';
import { ApiError } from '../src/platform/api-error';
import { applyUnauthorizedSessionPolicy } from '../src/platform/api-session-policy';
import { AuthSessionManager } from '../src/platform/auth-session';
import { AUTH_TOKEN_STORAGE_KEY, WebStorageLike, webAuthTokenStore } from '../src/platform/auth-token-store';
import { selectAuthTokenStore } from '../src/platform/auth-token-store-selection';
import { clearAuthSensitivePreferences, getActiveSchoolId, getPlatformTargetSchoolId, setActiveSchoolId, setPlatformTargetSchoolId } from '../src/platform/client-preferences';
import { performLogin } from '../src/platform/login-flow';
import { createNativeSecureAuthTokenStore, NATIVE_AUTH_TOKEN_KEY, SecureAuthStorageError, SecureStringStore } from '../src/platform/native-secure-auth-token-store';

function assertToken(actual: string | null | undefined, expected: string | null): void {
  assert((actual ?? null) === expected, 'Token state mismatch');
}

class MemoryLegacyStorage implements WebStorageLike {
  readonly values = new Map<string, string>();
  setCount = 0;
  removeCount = 0;

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.setCount += 1; this.values.set(key, value); }
  removeItem(key: string): void { this.removeCount += 1; this.values.delete(key); }
}

class MemorySecureStorage implements SecureStringStore {
  readonly values = new Map<string, string>();
  setCount = 0;
  removeCount = 0;
  failSet = false;
  failRemove = false;
  mismatchAfterSet = false;
  failReadAfterSet = false;

  async getItem(key: string): Promise<string | null> {
    if (this.setCount > 0 && this.failReadAfterSet) throw new Error('sensitive failure detail');
    if (this.setCount > 0 && this.mismatchAfterSet) return 'mismatched-token';
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.setCount += 1;
    if (this.failSet) throw new Error('sensitive failure detail');
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.removeCount += 1;
    if (this.failRemove) throw new Error('sensitive failure detail');
    this.values.delete(key);
  }
}

class DelayedSecureStorage extends MemorySecureStorage {
  readonly removalStarted: Promise<void>;
  private readonly removalGate: Promise<void>;
  private markRemovalStarted!: () => void;
  private releaseRemovalGate!: () => void;

  constructor() {
    super();
    this.removalStarted = new Promise((resolve) => { this.markRemovalStarted = resolve; });
    this.removalGate = new Promise((resolve) => { this.releaseRemovalGate = resolve; });
  }

  releaseRemoval(): void { this.releaseRemovalGate(); }

  override async removeItem(key: string): Promise<void> {
    this.markRemovalStarted();
    await this.removalGate;
    await super.removeItem(key);
  }
}

class DelayedMigrationStorage extends MemorySecureStorage {
  readonly migrationStarted: Promise<void>;
  private readonly migrationGate: Promise<void>;
  private markMigrationStarted!: () => void;
  private releaseMigrationGate!: () => void;

  constructor() {
    super();
    this.migrationStarted = new Promise((resolve) => { this.markMigrationStarted = resolve; });
    this.migrationGate = new Promise((resolve) => { this.releaseMigrationGate = resolve; });
  }

  releaseMigration(): void { this.releaseMigrationGate(); }

  override async setItem(key: string, value: string): Promise<void> {
    if (value === 'legacy-token') {
      this.markMigrationStarted();
      await this.migrationGate;
    }
    await super.setItem(key, value);
  }
}

const webStorage = new MemoryLegacyStorage();
const secureStorage = new MemorySecureStorage();
assert.equal(selectAuthTokenStore('WEB', secureStorage, webStorage), webAuthTokenStore);
assert.notEqual(selectAuthTokenStore('ANDROID', secureStorage, webStorage), webAuthTokenStore);
assert.notEqual(selectAuthTokenStore('IOS', secureStorage, webStorage), webAuthTokenStore);
assertToken(await selectAuthTokenStore('IOS', secureStorage, webStorage).get(), null);

const emptyStore = createNativeSecureAuthTokenStore(new MemorySecureStorage(), new MemoryLegacyStorage());
assertToken(await emptyStore.get(), null);

const existingSecure = new MemorySecureStorage();
existingSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'secure-token');
const existingLegacy = new MemoryLegacyStorage();
assertToken(await createNativeSecureAuthTokenStore(existingSecure, existingLegacy).get(), 'secure-token');
existingLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-token');
assertToken(await createNativeSecureAuthTokenStore(existingSecure, existingLegacy).get(), 'secure-token');
assertToken(existingLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), null);
assert.equal(existingSecure.setCount, 0);

const migratedSecure = new MemorySecureStorage();
const migratedLegacy = new MemoryLegacyStorage();
migratedLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-token');
const migratedStore = createNativeSecureAuthTokenStore(migratedSecure, migratedLegacy);
assertToken(await migratedStore.get(), 'legacy-token');
assertToken(migratedSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'legacy-token');
assertToken(migratedLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), null);
assertToken(await new AuthSessionManager(migratedStore).hydrate(), 'legacy-token');
assert.equal(migratedSecure.setCount, 1);

const concurrentSecure = new DelayedMigrationStorage();
const concurrentLegacy = new MemoryLegacyStorage();
concurrentLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-token');
const concurrentSession = new AuthSessionManager(createNativeSecureAuthTokenStore(concurrentSecure, concurrentLegacy));
const concurrentHydration = concurrentSession.hydrate();
await concurrentSecure.migrationStarted;
const concurrentLogin = concurrentSession.setToken('new-token');
concurrentSecure.releaseMigration();
await Promise.all([concurrentHydration, concurrentLogin]);
assertToken(await concurrentSession.getToken(), 'new-token');
assertToken(concurrentSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'new-token');
assertToken(concurrentLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), null);

const unreadableSecure = new MemorySecureStorage();
unreadableSecure.failReadAfterSet = true;
unreadableSecure.setCount = 1;
unreadableSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'secure-token');
const unreadableLegacy = new MemoryLegacyStorage();
unreadableLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-token');
await assert.rejects(
  () => createNativeSecureAuthTokenStore(unreadableSecure, unreadableLegacy).get(),
  SecureAuthStorageError,
);
assertToken(unreadableLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), 'legacy-token');

for (const failure of ['set', 'mismatch', 'read'] as const) {
  const failingSecure = new MemorySecureStorage();
  failingSecure.failSet = failure === 'set';
  failingSecure.mismatchAfterSet = failure === 'mismatch';
  failingSecure.failReadAfterSet = failure === 'read';
  const failingLegacy = new MemoryLegacyStorage();
  failingLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-token');
  const failingStore = createNativeSecureAuthTokenStore(failingSecure, failingLegacy);
  await assert.rejects(() => new AuthSessionManager(failingStore).hydrate(), (error: unknown) => {
    assert(error instanceof SecureAuthStorageError);
    assert(!error.message.includes('legacy-token'));
    assert(!error.message.includes('sensitive failure detail'));
    return true;
  });
  assertToken(failingLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), 'legacy-token');
  assert.equal(failingLegacy.removeCount, 0);
  assertToken(failingSecure.values.get(NATIVE_AUTH_TOKEN_KEY), null);
}

const loginSecure = new MemorySecureStorage();
const loginLegacy = new MemoryLegacyStorage();
loginLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'previous-token');
const legacyWritesBeforeLogin = loginLegacy.setCount;
const loginStore = createNativeSecureAuthTokenStore(loginSecure, loginLegacy);
const loginSession = new AuthSessionManager(loginStore);
let runtimeClears = 0;
const clearRuntimeSession = () => { runtimeClears += 1; };
assert.deepEqual(await performLogin({
  authenticate: async () => ({ token: 'new-token' }),
  bootstrap: async () => { assertToken(await loginSession.getToken(), 'new-token'); },
  session: loginSession,
  clearRuntimeSession,
}), { ok: true });
assertToken(loginSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'new-token');
assertToken(loginLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), null);
assert.equal(loginLegacy.setCount, legacyWritesBeforeLogin);
assertToken(await new AuthSessionManager(loginStore).hydrate(), 'new-token');

const wrongPasswordSecure = new MemorySecureStorage();
assert.deepEqual(await performLogin({
  authenticate: async (): Promise<{ token: string }> => { throw new ApiError(401, 'Invalid credentials'); },
  bootstrap: async () => { throw new Error('Must not bootstrap'); },
  session: new AuthSessionManager(createNativeSecureAuthTokenStore(wrongPasswordSecure, new MemoryLegacyStorage())),
  clearRuntimeSession,
}), { ok: false, reason: 'INVALID_CREDENTIALS' });
assert.equal(wrongPasswordSecure.setCount, 0);

const bootstrapSecure = new MemorySecureStorage();
const bootstrapSession = new AuthSessionManager(createNativeSecureAuthTokenStore(bootstrapSecure, new MemoryLegacyStorage()));
assert.deepEqual(await performLogin({
  authenticate: async () => ({ token: 'temporary-token' }),
  bootstrap: async () => { throw new Error('Bootstrap failed'); },
  session: bootstrapSession,
  clearRuntimeSession,
}), { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });
assertToken(await bootstrapSession.getToken(), null);
assertToken(bootstrapSecure.values.get(NATIVE_AUTH_TOKEN_KEY), null);

const writeFailSecure = new MemorySecureStorage();
writeFailSecure.failSet = true;
const writeFailSession = new AuthSessionManager(createNativeSecureAuthTokenStore(writeFailSecure, new MemoryLegacyStorage()));
assert.deepEqual(await performLogin({
  authenticate: async () => ({ token: 'temporary-token' }),
  bootstrap: async () => { throw new Error('Must not bootstrap'); },
  session: writeFailSession,
  clearRuntimeSession,
}), { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });
assertToken(await writeFailSession.getToken(), null);
assertToken(writeFailSecure.values.get(NATIVE_AUTH_TOKEN_KEY), null);

const invalidationSecure = new MemorySecureStorage();
invalidationSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'rejected-token');
const invalidationSession = new AuthSessionManager(createNativeSecureAuthTokenStore(invalidationSecure, new MemoryLegacyStorage()));
let unauthorizedEvents = 0;
invalidationSession.subscribe(() => { unauthorizedEvents += 1; });
assert.equal(await applyUnauthorizedSessionPolicy(403, '/api/user/me', 'rejected-token', invalidationSession), false);
assertToken(invalidationSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'rejected-token');
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/user/me', 'rejected-token', invalidationSession), true);
assertToken(invalidationSecure.values.get(NATIVE_AUTH_TOKEN_KEY), null);
assert.equal(unauthorizedEvents, 1);

const logoutSecure = new MemorySecureStorage();
logoutSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'active-token');
const logoutLegacy = new MemoryLegacyStorage();
logoutLegacy.setItem(AUTH_TOKEN_STORAGE_KEY, 'stale-token');
const logoutSession = new AuthSessionManager(createNativeSecureAuthTokenStore(logoutSecure, logoutLegacy));
setActiveSchoolId('school-a');
setPlatformTargetSchoolId('school-b');
await logoutSession.clearToken();
clearAuthSensitivePreferences();
assertToken(logoutSecure.values.get(NATIVE_AUTH_TOKEN_KEY), null);
assertToken(logoutLegacy.getItem(AUTH_TOKEN_STORAGE_KEY), null);
assert.equal(getActiveSchoolId(), null);
assert.equal(getPlatformTargetSchoolId(), null);

const removalFailSecure = new MemorySecureStorage();
removalFailSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'active-token');
const removalFailSession = new AuthSessionManager(createNativeSecureAuthTokenStore(removalFailSecure, new MemoryLegacyStorage()));
assertToken(await removalFailSession.hydrate(), 'active-token');
removalFailSecure.failRemove = true;
await assert.rejects(() => removalFailSession.clearToken(), SecureAuthStorageError);
assertToken(await removalFailSession.getToken(), 'active-token');
assertToken(removalFailSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'active-token');

const delayedSecure = new DelayedSecureStorage();
delayedSecure.values.set(NATIVE_AUTH_TOKEN_KEY, 'old-token');
const delayedSession = new AuthSessionManager(createNativeSecureAuthTokenStore(delayedSecure, new MemoryLegacyStorage()));
let delayedUnauthorizedEvents = 0;
delayedSession.subscribe(() => { delayedUnauthorizedEvents += 1; });
assertToken(await delayedSession.hydrate(), 'old-token');
const staleInvalidation = delayedSession.invalidateRejectedToken('old-token');
await delayedSecure.removalStarted;
const newLogin = delayedSession.setToken('new-token');
delayedSecure.releaseRemoval();
await Promise.all([staleInvalidation, newLogin]);
assertToken(await delayedSession.getToken(), 'new-token');
assertToken(delayedSecure.values.get(NATIVE_AUTH_TOKEN_KEY), 'new-token');
assert.equal(delayedUnauthorizedEvents, 0);

console.log('Native secure JWT storage, migration, login, logout, 401 and race tests PASS.');
