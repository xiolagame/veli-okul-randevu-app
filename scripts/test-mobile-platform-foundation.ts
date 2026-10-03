import assert from 'node:assert/strict';
import { applyUnauthorizedSessionPolicy } from '../src/platform/api-session-policy';
import { AuthSessionManager } from '../src/platform/auth-session';
import { AUTH_TOKEN_STORAGE_KEY, AuthTokenStore, WebStorageLike, createWebAuthTokenStore } from '../src/platform/auth-token-store';
import { decideBackNavigation } from '../src/platform/back-navigation';
import { createBrowserLifecycleAdapter } from '../src/platform/browser-lifecycle';
import { createBrowserNetworkAdapter } from '../src/platform/browser-network';
import { clearAuthSensitivePreferences, getActiveSchoolId, getPlatformTargetSchoolId, setActiveSchoolId, setPlatformTargetSchoolId } from '../src/platform/client-preferences';
import { PendingNavigationIntentStore, parseNavigationIntent } from '../src/platform/navigation-intent';

class MemoryStorage implements WebStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class MemoryTokenStore implements AuthTokenStore {
  token: string | null;
  removeCount = 0;

  constructor(token: string | null = null) {
    this.token = token;
  }

  async get() { return this.token; }
  async set(token: string) { this.token = token; }
  async remove() { this.removeCount += 1; this.token = null; }
}

class DelayedRemovalTokenStore extends MemoryTokenStore {
  readonly removalStarted: Promise<void>;
  private readonly removalGate: Promise<void>;
  private markRemovalStarted!: () => void;
  private releaseRemovalGate!: () => void;

  constructor(token: string) {
    super(token);
    this.removalStarted = new Promise((resolve) => { this.markRemovalStarted = resolve; });
    this.removalGate = new Promise((resolve) => { this.releaseRemovalGate = resolve; });
  }

  releaseRemoval(): void {
    this.releaseRemovalGate();
  }

  override async remove(): Promise<void> {
    this.removeCount += 1;
    this.markRemovalStarted();
    await this.removalGate;
    this.token = null;
  }
}

const browserStorage = new MemoryStorage();
browserStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'existing-session-token');
const webStore = createWebAuthTokenStore(browserStorage);
assert.equal(await webStore.get(), 'existing-session-token');
await webStore.set('replacement-session-token');
assert.equal(browserStorage.getItem(AUTH_TOKEN_STORAGE_KEY), 'replacement-session-token');
await webStore.remove();
assert.equal(browserStorage.getItem(AUTH_TOKEN_STORAGE_KEY), null);

const originalConsole = { log: console.log, warn: console.warn, error: console.error };
let consoleCalls = 0;
console.log = () => { consoleCalls += 1; };
console.warn = () => { consoleCalls += 1; };
console.error = () => { consoleCalls += 1; };
await webStore.set('never-log-this-token');
await webStore.get();
await webStore.remove();
console.log = originalConsole.log;
console.warn = originalConsole.warn;
console.error = originalConsole.error;
assert.equal(consoleCalls, 0);

const anonymousSession = new AuthSessionManager(new MemoryTokenStore());
assert.equal(await anonymousSession.hydrate(), null);

const storedSession = new AuthSessionManager(new MemoryTokenStore('stored-token'));
assert.equal(await storedSession.hydrate(), 'stored-token');

const protectedStore = new MemoryTokenStore('protected-token');
const protectedSession = new AuthSessionManager(protectedStore);
let invalidationEvents = 0;
protectedSession.subscribe(() => { invalidationEvents += 1; });
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/user/me', 'protected-token', protectedSession), true);
assert.equal(await protectedSession.getToken(), null);
assert.equal(invalidationEvents, 1);

const loginStore = new MemoryTokenStore('current-token');
const loginSession = new AuthSessionManager(loginStore);
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/auth/login', 'current-token', loginSession), false);
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/public/schools', 'current-token', loginSession), false);
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/schools/school-a/appointments/email-review', 'current-token', loginSession), false);
assert.equal(await loginSession.getToken(), 'current-token');
assert.equal(await applyUnauthorizedSessionPolicy(403, '/api/user/me', 'current-token', loginSession), false);
assert.equal(await loginSession.getToken(), 'current-token');

const parallelStore = new MemoryTokenStore('parallel-token');
const parallelSession = new AuthSessionManager(parallelStore);
let parallelEvents = 0;
parallelSession.subscribe(() => { parallelEvents += 1; });
await Promise.all([
  parallelSession.invalidateRejectedToken('parallel-token'),
  parallelSession.invalidateRejectedToken('parallel-token'),
  parallelSession.invalidateRejectedToken('parallel-token'),
]);
assert.equal(parallelStore.removeCount, 1);
assert.equal(parallelEvents, 1);

const raceStore = new DelayedRemovalTokenStore('old-token');
const raceSession = new AuthSessionManager(raceStore);
let raceInvalidationEvents = 0;
raceSession.subscribe(() => { raceInvalidationEvents += 1; });
assert.equal(await raceSession.hydrate(), 'old-token');
const staleInvalidation = raceSession.invalidateRejectedToken('old-token');
await raceStore.removalStarted;
const newLogin = raceSession.setToken('new-token');
raceStore.releaseRemoval();
await Promise.all([staleInvalidation, newLogin]);
assert.equal(await raceSession.getToken(), 'new-token');
assert.equal(raceStore.token, 'new-token');
assert.equal(raceInvalidationEvents, 0);

setActiveSchoolId('school-a');
setPlatformTargetSchoolId('school-b');
clearAuthSensitivePreferences();
assert.equal(getActiveSchoolId(), null);
assert.equal(getPlatformTargetSchoolId(), null);

const origin = 'https://velirandevu.com';
assert.deepEqual(parseNavigationIntent('/app/appointments/appointment-123', origin), { type: 'APPOINTMENT', resourceId: 'appointment-123' });
assert.deepEqual(parseNavigationIntent('/app/support/request_123', origin), { type: 'SUPPORT_REQUEST', resourceId: 'request_123' });
assert.deepEqual(parseNavigationIntent('/app/platform-requests/request-123', origin), { type: 'PLATFORM_REQUEST', resourceId: 'request-123' });
assert.deepEqual(parseNavigationIntent('/app/notifications', origin), { type: 'NOTIFICATIONS' });
assert.equal(parseNavigationIntent('https://example.com/app/notifications', origin), null);
assert.equal(parseNavigationIntent('javascript:alert(1)', origin), null);
assert.equal(parseNavigationIntent('data:text/html,unsafe', origin), null);
assert.equal(parseNavigationIntent('/app/appointments/bad%20id', origin), null);
assert.equal(parseNavigationIntent('/app/appointments/../secret', origin), null);
assert.equal(parseNavigationIntent('/app/appointments/id?token=secret', origin), null);
assert.equal(parseNavigationIntent('/app/appointments/id#qr-token', origin), null);
assert.equal(parseNavigationIntent('/appointment-review/token', origin), null);

const pendingIntentStore = new PendingNavigationIntentStore();
const pendingIntent = parseNavigationIntent('/app/support/request-123', origin);
assert(pendingIntent);
pendingIntentStore.set(pendingIntent);
assert.deepEqual(pendingIntentStore.peek(), pendingIntent);
assert.deepEqual(pendingIntentStore.take(), pendingIntent);
assert.equal(pendingIntentStore.peek(), null);

type EventListener = () => void;
const lifecycleListeners = new Set<EventListener>();
const lifecycleSource = {
  visibilityState: 'visible',
  addEventListener(_type: 'visibilitychange', listener: EventListener) { lifecycleListeners.add(listener); },
  removeEventListener(_type: 'visibilitychange', listener: EventListener) { lifecycleListeners.delete(listener); },
};
const lifecycle = createBrowserLifecycleAdapter(lifecycleSource);
const lifecycleStates: string[] = [];
const unsubscribeLifecycle = lifecycle.subscribe((state) => lifecycleStates.push(state));
lifecycleSource.visibilityState = 'hidden';
lifecycleListeners.forEach((listener) => listener());
assert.deepEqual(lifecycleStates, ['INACTIVE']);
unsubscribeLifecycle();
assert.equal(lifecycleListeners.size, 0);

const onlineListeners = new Set<EventListener>();
const offlineListeners = new Set<EventListener>();
const networkSource = {
  addEventListener(type: 'online' | 'offline', listener: EventListener) { (type === 'online' ? onlineListeners : offlineListeners).add(listener); },
  removeEventListener(type: 'online' | 'offline', listener: EventListener) { (type === 'online' ? onlineListeners : offlineListeners).delete(listener); },
};
const navigatorSource = { onLine: true };
const network = createBrowserNetworkAdapter(networkSource, navigatorSource);
const networkStates: string[] = [];
const unsubscribeNetwork = network.subscribe((state) => networkStates.push(state));
navigatorSource.onLine = false;
offlineListeners.forEach((listener) => listener());
assert.deepEqual(networkStates, ['DISCONNECTED']);
unsubscribeNetwork();
assert.equal(onlineListeners.size, 0);
assert.equal(offlineListeners.size, 0);

assert.equal(createBrowserLifecycleAdapter(null).getCurrentState(), 'ACTIVE');
assert.equal(createBrowserNetworkAdapter(null, null).getCurrentHint(), 'CONNECTED');
assert.equal(decideBackNavigation({ hasOpenModal: true, hasOpenDetail: true, hasSecondaryRoleView: true }), 'CLOSE_MODAL');
assert.equal(decideBackNavigation({ hasOpenModal: false, hasOpenDetail: true, hasSecondaryRoleView: true }), 'BACK_TO_LIST');
assert.equal(decideBackNavigation({ hasOpenModal: false, hasOpenDetail: false, hasSecondaryRoleView: true }), 'BACK_TO_ROLE_HOME');
assert.equal(decideBackNavigation({ hasOpenModal: false, hasOpenDetail: false, hasSecondaryRoleView: false }), 'DEFER_TO_NATIVE_SHELL');

console.log('Mobile platform auth store, session policy, lifecycle, network, navigation intent and back contract tests PASS.');
