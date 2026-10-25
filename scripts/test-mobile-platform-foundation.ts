import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyUnauthorizedSessionPolicy, isAuthenticatedApiEndpoint } from '../src/platform/api-session-policy';
import { AuthSessionManager } from '../src/platform/auth-session';
import { AUTH_TOKEN_STORAGE_KEY, AuthTokenStore, WebStorageLike, createWebAuthTokenStore } from '../src/platform/auth-token-store';
import { decideBackNavigation, hasBackHandler, invokeBackHandler, registerBackHandler } from '../src/platform/back-navigation';
import { canStartRefreshGesture, isRefreshPull } from '../src/platform/pull-to-refresh';
import { isCurrentMobileRefresh } from '../src/platform/mobile-refresh-guard';
import { createBrowserLifecycleAdapter } from '../src/platform/browser-lifecycle';
import { createBrowserNetworkAdapter } from '../src/platform/browser-network';
import { clearAuthSensitivePreferences, getActiveSchoolId, getPlatformTargetSchoolId, setActiveSchoolId, setPlatformTargetSchoolId } from '../src/platform/client-preferences';
import { PendingNavigationIntentStore, parseNavigationIntent } from '../src/platform/navigation-intent';
import { ApiError } from '../src/platform/api-error';
import { performLogin } from '../src/platform/login-flow';
import { resolveSchoolContext } from '../src/platform/school-resolution';
import { restoreExistingSession } from '../src/platform/session-restore';
import { subscribeToNativeBackNavigation } from '../src/platform/native-back-navigation';
import type { School, SchoolMembership } from '../src/types';
import type { ManagedSchool } from '../src/types/platform';

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

const platformStore = new MemoryTokenStore('platform-session');
const platformSession = new AuthSessionManager(platformStore);
let platformLogoutEvents = 0;
platformSession.subscribe(() => { platformLogoutEvents += 1; });
for (const [status, code] of [[500, undefined], [503, undefined], [401, 'PLATFORM_BINDING_VERIFICATION_FAILED']] as const) {
  assert.equal(await applyUnauthorizedSessionPolicy(status, '/api/platform/email-binding/start', 'platform-session', platformSession, code), false);
  assert.equal(await platformSession.getToken(), 'platform-session');
  assert.equal(platformStore.token, 'platform-session');
  assert.equal(platformStore.removeCount, 0);
  assert.equal(platformLogoutEvents, 0);
}
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/platform/email-binding/start', 'platform-session', platformSession), true);
assert.equal(platformStore.token, null);
assert.equal(platformLogoutEvents, 1, 'JWT rejection must still log out');

const offlineRestoreStore = new MemoryTokenStore('offline-token');
const offlineRestoreSession = new AuthSessionManager(offlineRestoreStore);
assert.equal(await restoreExistingSession({
  session: offlineRestoreSession,
  bootstrap: async () => { throw new Error('network unavailable'); },
}), 'RETRYABLE_FAILURE');
assert.equal(await offlineRestoreSession.getToken(), 'offline-token');
assert.equal(offlineRestoreStore.token, 'offline-token');
let restoredToken = '';
assert.equal(await restoreExistingSession({
  session: offlineRestoreSession,
  bootstrap: async (token) => { restoredToken = token; },
}), 'RESTORED');
assert.equal(restoredToken, 'offline-token');

const rejectedRestoreStore = new MemoryTokenStore('rejected-token');
const rejectedRestoreSession = new AuthSessionManager(rejectedRestoreStore);
assert.equal(await restoreExistingSession({
  session: rejectedRestoreSession,
  bootstrap: async (token) => {
    await rejectedRestoreSession.invalidateRejectedToken(token);
    throw new ApiError(401, 'Unauthorized');
  },
}), 'SESSION_CHANGED');
assert.equal(await rejectedRestoreSession.getToken(), null);

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
assert.equal(isAuthenticatedApiEndpoint('/api/public/schools'), true);
assert.equal(isAuthenticatedApiEndpoint('/api/public/school-context'), false);
assert.equal(isAuthenticatedApiEndpoint('/api/public/requests'), false);
assert.equal(isAuthenticatedApiEndpoint('/api/public/school-context?code=SCHOOL'), false);
assert.equal(isAuthenticatedApiEndpoint('/api/public/school-context-fake'), true);
assert.equal(isAuthenticatedApiEndpoint('/api/public/schools?refresh=1'), true);
assert.equal(isAuthenticatedApiEndpoint('/api/schools/school-a/appointments/email-review'), true);
assert.equal(isAuthenticatedApiEndpoint('/api/schools/school-a/appointments/email-review/approve'), true);
assert.equal(await loginSession.getToken(), 'current-token');
assert.equal(await applyUnauthorizedSessionPolicy(403, '/api/user/me', 'current-token', loginSession), false);
assert.equal(await loginSession.getToken(), 'current-token');
assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/public/schools', 'current-token', loginSession), true);
assert.equal(await loginSession.getToken(), null);

const invalidLoginStore = new MemoryTokenStore();
const invalidLoginSession = new AuthSessionManager(invalidLoginStore);
let runtimeClearCount = 0;
const clearRuntimeSession = () => { runtimeClearCount += 1; clearAuthSensitivePreferences(); };
assert.deepEqual(await performLogin({
  authenticate: async (): Promise<{ token: string }> => { throw new ApiError(401, 'Invalid credentials'); },
  bootstrap: async () => { throw new Error('Bootstrap must not run'); },
  session: invalidLoginSession,
  clearRuntimeSession,
}), { ok: false, reason: 'INVALID_CREDENTIALS' });
assert.equal(await invalidLoginSession.getToken(), null);
assert.equal(invalidLoginStore.token, null);
assert.equal(runtimeClearCount, 0);

const successfulLoginStore = new MemoryTokenStore();
const successfulLoginSession = new AuthSessionManager(successfulLoginStore);
let bootstrapToken: string | null = null;
assert.deepEqual(await performLogin({
  authenticate: async () => ({ token: 'valid-token' }),
  bootstrap: async () => { bootstrapToken = await successfulLoginSession.getToken(); },
  session: successfulLoginSession,
  clearRuntimeSession,
}), { ok: true });
assert.equal(bootstrapToken, 'valid-token');
assert.equal(successfulLoginStore.token, 'valid-token');

for (const bootstrapError of [new Error('network unavailable'), new ApiError(401, 'Unauthorized'), new ApiError(403, 'Forbidden')]) {
  const failedLoginStore = new MemoryTokenStore();
  const failedLoginSession = new AuthSessionManager(failedLoginStore);
  setActiveSchoolId('stale-school');
  setPlatformTargetSchoolId('stale-target');
  const clearsBefore = runtimeClearCount;
  assert.deepEqual(await performLogin({
    authenticate: async () => ({ token: 'temporary-token' }),
    bootstrap: async () => { throw bootstrapError; },
    session: failedLoginSession,
    clearRuntimeSession,
  }), { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });
  assert.equal(failedLoginStore.token, null);
  assert.equal(await failedLoginSession.getToken(), null);
  assert.equal(await new AuthSessionManager(failedLoginStore).hydrate(), null);
  assert.equal(getActiveSchoolId(), null);
  assert.equal(getPlatformTargetSchoolId(), null);
  assert.equal(runtimeClearCount, clearsBefore + 1);
}
assert.deepEqual(await performLogin({
  authenticate: async (): Promise<{ token: string }> => { throw new Error('network unavailable'); },
  bootstrap: async () => { throw new Error('Bootstrap must not run'); },
  session: invalidLoginSession,
  clearRuntimeSession,
}), { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });
assert.deepEqual(await performLogin({
  authenticate: async (): Promise<{ token: string }> => { throw new ApiError(500, 'Server error'); },
  bootstrap: async () => { throw new Error('Bootstrap must not run'); },
  session: invalidLoginSession,
  clearRuntimeSession,
}), { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });

const replacingStore = new MemoryTokenStore();
const replacingSession = new AuthSessionManager(replacingStore);
let markBootstrapStarted!: () => void;
let releaseBootstrap!: () => void;
const bootstrapStarted = new Promise<void>((resolve) => { markBootstrapStarted = resolve; });
const bootstrapGate = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
const staleLogin = performLogin({
  authenticate: async () => ({ token: 'old-token' }),
  bootstrap: async () => { markBootstrapStarted(); await bootstrapGate; throw new Error('Old bootstrap failed'); },
  session: replacingSession,
  clearRuntimeSession,
});
await bootstrapStarted;
assert.deepEqual(await performLogin({
  authenticate: async () => ({ token: 'new-token' }),
  bootstrap: async () => {},
  session: replacingSession,
  clearRuntimeSession,
}), { ok: true });
const clearsBeforeStaleFailure = runtimeClearCount;
releaseBootstrap();
assert.deepEqual(await staleLogin, { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' });
assert.equal(await replacingSession.getToken(), 'new-token');
assert.equal(replacingStore.token, 'new-token');
assert.equal(runtimeClearCount, clearsBeforeStaleFailure);

const schoolA: School = { id: 'school-a', name: 'School A', code: 'A', city: '', district: '', settings: { schoolName: 'School A', appName: 'Veli Randevu', defaultSlotMinutes: 15, minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true } };
const schoolB: School = { ...schoolA, id: 'school-b', name: 'School B', code: 'B' };
const membershipA: SchoolMembership = { id: 'member-a', schoolId: schoolA.id, userId: 'user-a', role: 'admin', status: 'active', joinedAt: '2026-01-01' };
const inactiveMembershipB: SchoolMembership = { ...membershipA, id: 'member-b', schoolId: schoolB.id, status: 'suspended' };
const managedSchool: ManagedSchool = { id: 'platform-school', name: 'Platform School', code: 'P', city: '', district: '', disabledAt: null, licenseCode: null, licenseStatus: 'active', licenseExpiresAt: null, adminStatus: 'active', adminName: null };
const resolve = (memberships: SchoolMembership[], accessibleSchools: School[], isPlatformAdmin = false, managedSchools: ManagedSchool[] = []) =>
  resolveSchoolContext({ memberships, accessibleSchools, isPlatformAdmin, managedSchools });
assert.deepEqual(resolve([membershipA], [schoolA]), { kind: 'MEMBERSHIP', school: schoolA, membership: membershipA, schoolId: schoolA.id });
assert.equal(resolveSchoolContext({ memberships: [membershipA], accessibleSchools: [schoolB, schoolA], managedSchools: [], isPlatformAdmin: false, preferredSchoolId: schoolB.id }).schoolId, schoolA.id);
assert.equal(resolve([membershipA], []).schoolId, null);
assert.equal(resolve([], [schoolB]).schoolId, null);
assert.equal(resolve([inactiveMembershipB], [schoolB]).schoolId, null);
assert.equal(resolve([], [schoolB]).schoolId, null);
assert.deepEqual(resolve([], [], true, [managedSchool]), { kind: 'PLATFORM_TARGET', school: managedSchool, membership: null, schoolId: managedSchool.id });
assert.equal(resolve([membershipA], [schoolA], true, [managedSchool]).membership, null);
assert.equal(resolve([], [], true, [{ ...managedSchool, disabledAt: '2026-01-01' }]).schoolId, null);

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

assert.equal(isRefreshPull(0, 72), true);
assert.equal(isRefreshPull(60, 72), false, 'horizontal gestures do not refresh');
assert.equal(isRefreshPull(0, 71), false, 'short scrolls do not refresh');
const pullContext = { atTop: true, modalOpen: false, nestedScroll: false, interactive: false };
assert.equal(canStartRefreshGesture(pullContext), true);
assert.equal(canStartRefreshGesture({ ...pullContext, atTop: false }), false);
assert.equal(canStartRefreshGesture({ ...pullContext, modalOpen: true }), false);
assert.equal(canStartRefreshGesture({ ...pullContext, nestedScroll: true }), false);
assert.equal(canStartRefreshGesture({ ...pullContext, interactive: true }), false);
const homeRefreshSource = readFileSync(new URL('../src/components/useHomeRefresh.tsx', import.meta.url), 'utf8');
assert.match(homeRefreshSource, /ios && enabled && \(busy \|\| message\)/, 'refresh feedback must be temporary');
assert.doesNotMatch(homeRefreshSource, /<Button\b|Bırakın, yenilensin\.|Veriler güncellendi\./, 'home must not show persistent refresh controls or copy');
const oldRefresh = { sequence: 5, revision: 2, notificationRevision: 4, schoolId: 'school-a' };
assert.equal(isCurrentMobileRefresh(oldRefresh, oldRefresh), true);
assert.equal(isCurrentMobileRefresh(oldRefresh, { ...oldRefresh, sequence: 6 }), false, 'logout or account change invalidates response');
assert.equal(isCurrentMobileRefresh(oldRefresh, { ...oldRefresh, schoolId: 'school-b' }), false, 'school change invalidates response');
assert.equal(isCurrentMobileRefresh(oldRefresh, { ...oldRefresh, revision: 3 }), false, 'newer refresh invalidates response');
assert.equal(isCurrentMobileRefresh(oldRefresh, { ...oldRefresh, notificationRevision: 5 }), false, 'notification deletion invalidates stale visibility');

let stackedBackCalls = 0;
const removeFirstBackHandler = registerBackHandler(() => { stackedBackCalls += 1; });
const removeSecondBackHandler = registerBackHandler(() => { stackedBackCalls += 10; });
assert.equal(hasBackHandler(), true);
assert.equal(invokeBackHandler(), true);
assert.equal(stackedBackCalls, 10);
removeSecondBackHandler();
assert.equal(invokeBackHandler(), true);
assert.equal(stackedBackCalls, 11);
removeFirstBackHandler();
assert.equal(hasBackHandler(), false);

let nativeBackListener: ((event: { canGoBack: boolean }) => void) | null = null;
let nativeBackRemoved = 0;
let nativeBackExited = 0;
let browserBackCalls = 0;
const nativeBackDecisions: string[] = [];
let nativeBackState = { hasOpenModal: true, hasOpenDetail: false, hasSecondaryRoleView: false };
const unsubscribeNativeBack = subscribeToNativeBackNavigation(
  () => nativeBackState,
  (decision) => nativeBackDecisions.push(decision),
  {
    addListener: async (_event, listener) => {
      nativeBackListener = listener;
      return { remove: async () => { nativeBackRemoved += 1; } };
    },
    exitApp: async () => { nativeBackExited += 1; },
  },
  () => 'ANDROID',
  () => { browserBackCalls += 1; },
);
nativeBackListener?.({ canGoBack: true });
assert.deepEqual(nativeBackDecisions, ['CLOSE_MODAL']);
nativeBackState = { hasOpenModal: false, hasOpenDetail: false, hasSecondaryRoleView: false };
nativeBackListener?.({ canGoBack: true });
assert.equal(browserBackCalls, 1);
nativeBackListener?.({ canGoBack: false });
await Promise.resolve();
assert.equal(nativeBackExited, 1);
unsubscribeNativeBack();
await Promise.resolve();
assert.equal(nativeBackRemoved, 1);

console.log('Mobile platform auth store, session policy, lifecycle, network, navigation intent and back contract tests PASS.');
