import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IosPushActivationError, IosPushManager } from '../src/platform/ios-push';
import { canUseAndroidPush, canUseMobilePush } from '../src/platform/push-eligibility';
import { pendingNavigationIntent } from '../src/platform/navigation-intent';
import { AuthSessionManager } from '../src/platform/auth-session';
import { pushPromptState } from '../src/components/push-prompt-state';

type Listener = (event: never) => void;

function createNative(permission: 'prompt' | 'granted' | 'denied' = 'prompt') {
  const events: string[] = [];
  const listeners = new Map<string, Listener>();
  let currentPermission = permission;
  let checkCount = 0;
  let requestCount = 0;
  const fire = (name: string, event: unknown) => listeners.get(name)?.(event as never);
  const native = {
    addListener: async (name: string, listener: Listener) => {
      listeners.set(name, listener);
      return { remove: async () => { if (listeners.get(name) === listener) listeners.delete(name); } };
    },
    checkPermissions: async () => { checkCount++; return { receive: currentPermission }; },
    requestPermissions: async () => {
      requestCount++;
      events.push('permission-request');
      currentPermission = 'granted';
      return { receive: currentPermission };
    },
    register: async () => {
      events.push('native-register');
      fire('registration', { value: 'raw-apns-device-token-must-never-be-saved' });
      fire('registrationError-unused', {});
      fire('pushNotificationReceived-unused', {});
    },
    unregister: async () => { events.push('native-unregister'); },
    removeAllDeliveredNotifications: async () => { events.push('delivered-clear'); },
  };
  return {
    native,
    events,
    listeners,
    fire,
    requestCount: () => requestCount,
    checkCount: () => checkCount,
    setPermission: (value: 'prompt' | 'granted' | 'denied') => { currentPermission = value; },
  };
}

function capacitorThenable<T extends object>(plugin: T, onThenAccess: () => void): T {
  return new Proxy(plugin, {
    get(target, property, receiver) {
      if (property === 'then') {
        onThenAccess();
        return () => {}; // Mimics a native plugin method that never settles Promise adoption.
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function createFcm(events: string[], token = 'fcm-registration-token-initial-123456') {
  const listeners = new Map<string, Listener>();
  const fcm = {
    addListener: async (name: string, listener: Listener) => {
      listeners.set(name, listener);
      return { remove: async () => { if (listeners.get(name) === listener) listeners.delete(name); } };
    },
    getToken: async () => ({ token }),
    setAutoInit: async ({ enabled }: { enabled: boolean }) => { events.push(`auto-init-${enabled}`); },
    // iOS Plugin.swift calls call.resolve(), which Capacitor bridges as undefined.
    deleteInstance: async () => { events.push('delete-instance'); },
  };
  return {
    fcm,
    listeners,
    fireToken: (value: string) => listeners.get('tokenReceived')?.({ token: value } as never),
  };
}

function createManager(options: {
  platform?: 'IOS' | 'ANDROID' | 'WEB';
  initialPermission?: 'prompt' | 'granted' | 'denied';
  failFirstRegistration?: boolean;
  registrationGate?: Promise<void>;
  registrationGates?: Promise<void>[];
  deactivationGate?: Promise<void>;
  failDeactivation?: boolean;
  activationTimeoutMs?: number;
  generationState?: { value: number };
  persistentIdentity?: boolean;
  capacitorThenableProxies?: boolean;
} = {}) {
  const nativeFixture = createNative(options.initialPermission);
  const fcmFixture = createFcm(nativeFixture.events);
  const registrations: Array<{ platform: string; provider: string; providerTarget: string }> = [];
  const registrationGenerations: number[] = [];
  const registrationInstallations: string[] = [];
  const deactivationGenerations: number[] = [];
  const generationState = options.generationState ?? { value: 1 };
  const lifecycle: string[] = [];
  const proxyThenAccesses: string[] = [];
  let registrationAttempts = 0;
  let settingsOpened = 0;
  const installationId = crypto.randomUUID();
  const attemptWaiters: Array<() => void> = [];
  const waitForAttempts = (expected: number) => registrationAttempts >= expected
    ? Promise.resolve()
    : new Promise<void>((resolve) => attemptWaiters.push(() => { if (registrationAttempts >= expected) resolve(); }));
  nativeFixture.native.register = async () => {
    nativeFixture.events.push('native-register');
    nativeFixture.fire('registration', { value: 'raw-apns-device-token-must-never-be-saved' });
    fcmFixture.fireToken('fcm-registration-token-initial-123456');
  };
  const manager = new IosPushManager({
    registerPushDevice: async (input) => {
      registrationGenerations.push(input.registrationGeneration);
      registrationInstallations.push(input.installationId);
      registrationAttempts++;
      for (const waiter of [...attemptWaiters]) waiter();
      nativeFixture.events.push('backend-register');
      const registrationGate = options.registrationGates?.[registrationAttempts - 1] ?? options.registrationGate;
      if (registrationGate) await registrationGate;
      if (options.failFirstRegistration && registrationAttempts === 1) throw new Error('offline');
      registrations.push({ platform: input.platform, provider: input.provider, providerTarget: input.providerTarget });
    },
    deactivatePushDevice: async (_installationId, generation) => {
      deactivationGenerations.push(generation);
      nativeFixture.events.push('backend-deactivate');
      if (options.deactivationGate) await options.deactivationGate;
      if (options.failDeactivation) throw new Error('offline');
    },
  }, () => options.platform || 'IOS', options.persistentIdentity ? undefined : () => installationId,
  (options.capacitorThenableProxies ? capacitorThenable(nativeFixture.native, () => proxyThenAccesses.push('apns')) : nativeFixture.native) as unknown as ConstructorParameters<typeof IosPushManager>[3],
  (options.capacitorThenableProxies ? capacitorThenable(fcmFixture.fcm, () => proxyThenAccesses.push('fcm')) : fcmFixture.fcm) as unknown as ConstructorParameters<typeof IosPushManager>[4],
  async () => { settingsOpened++; }, options.activationTimeoutMs,
  options.persistentIdentity ? undefined : () => generationState.value,
  options.persistentIdentity ? undefined : () => { generationState.value += 1; });
  return {
    manager, nativeFixture, fcmFixture, registrations, registrationGenerations, registrationInstallations,
    deactivationGenerations, generationState, lifecycle, proxyThenAccesses,
    registrationAttempts: () => registrationAttempts,
    waitForAttempts,
    settingsOpened: () => settingsOpened,
  };
}

async function testCapacitorPluginProxyIsNotAwaited() {
  const fixture = createManager({ capacitorThenableProxies: true, activationTimeoutMs: 20 });
  await fixture.manager.start('ios-teacher', 'teacher', () => {}, () => {});
  assert.equal(fixture.nativeFixture.checkCount(), 1, 'startup must reach native checkPermissions');
  assert.equal(fixture.nativeFixture.requestCount(), 0, 'startup must not prompt');
  assert.equal(await fixture.manager.enable(), 'ready');
  assert.equal(fixture.nativeFixture.checkCount(), 2, 'enable must reach native checkPermissions');
  assert.equal(fixture.nativeFixture.requestCount(), 1, 'enable must request iOS permission');
  assert.equal(fixture.registrationAttempts(), 1, 'ready requires backend registration');
  assert.deepEqual(fixture.proxyThenAccesses, [], 'neither Capacitor plugin proxy may be adopted as a Promise');
  await fixture.manager.beforeLogout();
}

async function waitForStatus(statuses: string[], expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100 && statuses.at(-1) !== expected; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(statuses.at(-1), expected);
}

async function testIosPermissionAndTokenLifecycle() {
  const fixture = createManager();
  const statuses: string[] = [];
  let refreshed = 0;
  await fixture.manager.start('ios-parent', 'parent', () => { refreshed++; }, (status) => statuses.push(status));
  assert.equal(fixture.nativeFixture.requestCount(), 0, 'start must not show the iOS permission prompt');
  assert(!fixture.nativeFixture.events.includes('native-register'));
  assert(fixture.nativeFixture.events.includes('auto-init-false'));

  assert.equal(await fixture.manager.enable(), 'ready');
  await fixture.waitForAttempts(1);
  assert.equal(fixture.nativeFixture.requestCount(), 1);
  assert.deepEqual(fixture.registrations, [{
    platform: 'IOS', provider: 'FCM', providerTarget: 'fcm-registration-token-initial-123456',
  }]);
  assert(!fixture.registrations.some((entry) => entry.providerTarget.includes('apns')));
  assert.equal(statuses.at(-1), 'ready');

  fixture.nativeFixture.fire('pushNotificationReceived', { data: { notificationId: 'notification-1' } });
  fixture.nativeFixture.fire('pushNotificationReceived', { data: { notificationId: 'notification-1' } });
  await Promise.resolve();
  assert.equal(refreshed, 1);

  fixture.fcmFixture.fireToken('fcm-registration-token-rotated-987654');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.registrations.at(-1)?.providerTarget, 'fcm-registration-token-rotated-987654');
  assert.equal(fixture.registrations.at(-1)?.platform, 'IOS');
  const registrationCount = fixture.registrations.length;
  fixture.fcmFixture.fireToken('a'.repeat(64));
  await Promise.resolve();
  assert.equal(fixture.registrations.length, registrationCount);
  await fixture.manager.beforeLogout();
  assert(fixture.nativeFixture.events.indexOf('backend-deactivate') < fixture.nativeFixture.events.indexOf('native-unregister'));
  assert(fixture.nativeFixture.events.includes('delete-instance'));
  assert(fixture.nativeFixture.events.includes('delivered-clear'));
  assert.equal(fixture.nativeFixture.listeners.size, 0);
}

async function testIosDeniedAndSettings() {
  const fixture = createManager();
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  fixture.nativeFixture.setPermission('denied');
  assert.equal(await fixture.manager.enable(), 'denied');
  const promptCount = fixture.nativeFixture.requestCount();
  await fixture.manager.refreshPermission();
  assert.equal(fixture.nativeFixture.requestCount(), promptCount, 'denied permission must not be prompted repeatedly');
  await fixture.manager.openNotificationSettings();
  assert.equal(fixture.settingsOpened(), 1);
  assert(!fixture.nativeFixture.events.includes('native-register'));
  fixture.nativeFixture.setPermission('granted');
  await fixture.manager.refreshPermission();
  await fixture.waitForAttempts(1);
  assert(fixture.nativeFixture.events.includes('native-register'));
  assert.equal(fixture.registrations.at(-1)?.provider, 'FCM');
  await fixture.manager.afterSessionInvalidated();
}

async function testReconnectRetryKeepsFcmTokenInMemory() {
  const fixture = createManager({ initialPermission: 'granted', failFirstRegistration: true });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await fixture.waitForAttempts(1);
  assert.equal(fixture.registrationAttempts(), 1);
  await waitForStatus(statuses, 'unavailable');
  await fixture.manager.refreshPermission();
  await fixture.waitForAttempts(2);
  await waitForStatus(statuses, 'ready');
  assert.equal(fixture.registrationAttempts(), 2);
  assert.equal(fixture.registrations.at(-1)?.providerTarget, 'fcm-registration-token-initial-123456');
  await fixture.manager.afterSessionInvalidated();
}

async function testNavigationAndPlatformGuards() {
  const fixture = createManager();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const windowEvents: string[] = [];
  let navigationDispatched!: () => void;
  const navigationEvent = new Promise<void>((resolve) => { navigationDispatched = resolve; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    dispatchEvent: (event: Event) => { windowEvents.push(event.type); navigationDispatched(); return true; },
  } });
  try {
    await fixture.manager.startNavigationCapture(async () => 'ios-session');
    fixture.nativeFixture.fire('pushNotificationActionPerformed', { notification: { data: { route: 'https://evil.example/app/appointments/apt-1' } } });
    assert.equal(pendingNavigationIntent.peek(), null);
    fixture.nativeFixture.fire('pushNotificationActionPerformed', { notification: { data: { route: '/app/appointments/apt-1' } } });
    await navigationEvent;
    assert.equal(pendingNavigationIntent.peek()?.type, 'APPOINTMENT');
    assert.deepEqual(windowEvents, ['veli:navigation-intent']);
    pendingNavigationIntent.clear();
    await fixture.manager.stopNavigationCapture();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }

  const web = createManager({ platform: 'WEB' });
  await web.manager.start('web-parent', 'parent', () => {}, () => {});
  await web.manager.openNotificationSettings();
  assert.equal(web.nativeFixture.listeners.size, 0);
  assert.equal(web.nativeFixture.events.length, 0);
  assert.equal(canUseMobilePush('parent', 'IOS'), true);
  assert.equal(canUseMobilePush('teacher', 'IOS'), true);
  assert.equal(canUseMobilePush('security', 'IOS'), false);
  assert.equal(canUseMobilePush('admin', 'IOS'), false);
  assert.equal(canUseMobilePush('parent', 'WEB'), false);
  assert.equal(canUseAndroidPush('parent', 'ANDROID'), true);
  assert.equal(canUseAndroidPush('parent', 'IOS'), false);
}

async function testLogoutWaitsForInFlightRegistration() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createManager({ registrationGate: gate });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  const enable = fixture.manager.enable();
  await fixture.waitForAttempts(1);
  const logout = fixture.manager.beforeLogout();
  release();
  await Promise.all([enable, logout]);
  assert(fixture.nativeFixture.events.indexOf('backend-register') < fixture.nativeFixture.events.indexOf('backend-deactivate'));
}

async function testPermissionRevocationWaitsForRegistration() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createManager({ initialPermission: 'granted', registrationGate: gate });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  await fixture.waitForAttempts(1);
  fixture.nativeFixture.setPermission('denied');
  let refreshCompleted = false;
  const refresh = fixture.manager.refreshPermission().then(() => { refreshCompleted = true; });
  await Promise.resolve();
  assert.equal(refreshCompleted, false);
  assert(!fixture.nativeFixture.events.includes('backend-deactivate'));
  release();
  await refresh;
  assert(fixture.nativeFixture.events.indexOf('backend-register') < fixture.nativeFixture.events.indexOf('backend-deactivate'));
  assert.equal(fixture.nativeFixture.events.at(-1), 'native-unregister');
}

async function expectActivationStage(work: Promise<unknown>, stage: IosPushActivationError['stage']): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof IosPushActivationError && error.stage === stage && !error.userMessage.includes('sensitive-value'), `Expected activation failure at ${stage}`);
}

async function testTimedOutPermissionCallsCanRetry() {
  const fixture = createManager({ activationTimeoutMs: 20 });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  const checkPermissions = fixture.nativeFixture.native.checkPermissions;
  fixture.nativeFixture.native.checkPermissions = async () => new Promise<never>(() => {});
  await expectActivationStage(fixture.manager.enable(), 'permission-check');
  fixture.nativeFixture.native.checkPermissions = checkPermissions;
  const requestPermissions = fixture.nativeFixture.native.requestPermissions;
  let finishRequest!: (value: { receive: 'granted' }) => void;
  fixture.nativeFixture.native.requestPermissions = async () => new Promise<{ receive: 'granted' }>((resolve) => { finishRequest = resolve; });
  await expectActivationStage(fixture.manager.enable(), 'permission-request');
  await expectActivationStage(fixture.manager.enable(), 'permission-request');
  finishRequest({ receive: 'granted' });
  fixture.nativeFixture.setPermission('granted');
  await new Promise<void>((resolve) => setImmediate(resolve));
  fixture.nativeFixture.native.requestPermissions = requestPermissions;
  assert.equal(await fixture.manager.enable(), 'ready');
  await fixture.manager.afterSessionInvalidated();
}

async function testTimedOutApnsAndFcmStages() {
  const fixture = createManager({ activationTimeoutMs: 20 });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  const setAutoInit = fixture.fcmFixture.fcm.setAutoInit;
  fixture.fcmFixture.fcm.setAutoInit = async () => new Promise<never>(() => {});
  await expectActivationStage(fixture.manager.enable(), 'fcm-init');
  fixture.fcmFixture.fcm.setAutoInit = setAutoInit;
  fixture.nativeFixture.native.register = async () => {
    fixture.nativeFixture.events.push('native-register');
    return new Promise<never>(() => {});
  };
  await expectActivationStage(fixture.manager.enable(), 'apns-register');
  await expectActivationStage(fixture.manager.enable(), 'apns-register');
  assert.equal(fixture.nativeFixture.events.filter((event) => event === 'native-register').length, 1);
  await fixture.manager.afterSessionInvalidated();

  const noCallback = createManager({ activationTimeoutMs: 20 });
  await noCallback.manager.start('ios-parent', 'parent', () => {}, () => {});
  noCallback.nativeFixture.native.register = async () => { noCallback.nativeFixture.events.push('native-register'); };
  await expectActivationStage(noCallback.manager.enable(), 'apns-callback');
  await expectActivationStage(noCallback.manager.enable(), 'apns-callback');
  assert.equal(noCallback.nativeFixture.events.filter((event) => event === 'native-register').length, 1);
  await noCallback.manager.afterSessionInvalidated();

  const noFcm = createManager({ activationTimeoutMs: 20 });
  await noFcm.manager.start('ios-parent', 'parent', () => {}, () => {});
  noFcm.nativeFixture.native.register = async () => { noFcm.nativeFixture.fire('registration', { value: 'not-a-stored-token' }); };
  noFcm.fcmFixture.fcm.getToken = async () => new Promise<never>(() => {});
  await expectActivationStage(noFcm.manager.enable(), 'fcm-token');
  await expectActivationStage(noFcm.manager.enable(), 'fcm-token');
  await noFcm.manager.afterSessionInvalidated();
}

async function testTimedOutBackendRegistrationDoesNotReportReady() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createManager({ registrationGate: gate, activationTimeoutMs: 20 });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await expectActivationStage(fixture.manager.enable(), 'device-registration');
  release();
  await Promise.resolve();
  assert.equal(statuses.at(-1), 'unavailable');
  await fixture.manager.afterSessionInvalidated();
}

async function testLateFirstBackendResultCannotCompleteOverlappingRetry() {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const fixture = createManager({ registrationGates: [firstGate, secondGate], activationTimeoutMs: 100 });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await expectActivationStage(fixture.manager.enable(), 'device-registration');
  let secondSettled = false;
  const second = fixture.manager.enable().finally(() => { secondSettled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  fixture.nativeFixture.fire('registration', { value: 'stale-apns-event' });
  fixture.fcmFixture.fireToken('stale-fcm-registration-token-123456');
  await Promise.resolve();
  assert.equal(fixture.registrationAttempts(), 1);
  assert.equal(statuses.at(-1), 'preparing');
  releaseFirst();
  await fixture.waitForAttempts(2);
  assert.equal(statuses.at(-1), 'preparing');
  assert.equal(secondSettled, false);
  assert.equal(fixture.nativeFixture.events.filter((event) => event === 'native-register').length, 1);
  releaseSecond();
  assert.equal(await second, 'ready');
  assert.equal(statuses.at(-1), 'ready');
  await fixture.manager.afterSessionInvalidated();
}

async function testLateFcmLookupCannotDowngradeReadyRegistration() {
  const fixture = createManager({ activationTimeoutMs: 20 });
  const statuses: string[] = [];
  fixture.fcmFixture.fcm.getToken = async () => new Promise<never>(() => {});
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  assert.equal(await fixture.manager.enable(), 'ready');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(statuses.at(-1), 'ready');
  await fixture.manager.afterSessionInvalidated();
}

async function testGrantedPermissionWithoutApnsCallbackDoesNotStayPreparing() {
  const fixture = createManager({ initialPermission: 'granted', activationTimeoutMs: 20 });
  const statuses: string[] = [];
  fixture.nativeFixture.native.register = async () => { fixture.nativeFixture.events.push('native-register'); };
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await waitForStatus(statuses, 'unavailable');
  assert.equal(fixture.nativeFixture.events.filter((event) => event === 'native-register').length, 1);
  await expectActivationStage(fixture.manager.enable(), 'apns-callback');
  await fixture.manager.afterSessionInvalidated();
}

async function testDeferredPromptKeepsEnableActionAvailable() {
  assert.deepEqual(pushPromptState('off', true), { showAction: true, showExplanation: false });
  assert.deepEqual(pushPromptState('unavailable', true), { showAction: true, showExplanation: false });
  assert.deepEqual(pushPromptState('ready', true), { showAction: false, showExplanation: false });
}

async function testPermissionRevocationWaitsForBackendDeactivation() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createManager({ initialPermission: 'granted', deactivationGate: gate, activationTimeoutMs: 100 });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await waitForStatus(statuses, 'ready');
  fixture.nativeFixture.setPermission('denied');
  const refresh = fixture.manager.refreshPermission();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(statuses.at(-1), 'preparing');
  assert(fixture.nativeFixture.events.includes('backend-deactivate'));
  release();
  await refresh;
  assert.equal(statuses.at(-1), 'denied');
  await fixture.manager.afterSessionInvalidated();
}

async function testUnconfirmedDeactivationIsNotReportedAsOff() {
  const fixture = createManager({ initialPermission: 'granted', deactivationGate: new Promise<void>(() => {}), activationTimeoutMs: 20 });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await waitForStatus(statuses, 'ready');
  fixture.nativeFixture.setPermission('denied');
  await fixture.manager.refreshPermission();
  assert.equal(statuses.at(-1), 'unavailable');
  await fixture.manager.afterSessionInvalidated();
}

async function withPushStorage(runTest: (values: Map<string, string>) => Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  try { await runTest(values); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

async function testStuckRegistrationDoesNotBlockLogoutOrBindNextAccount() {
  await withPushStorage(async (storage) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fixture = createManager({ registrationGates: [gate, Promise.resolve()], activationTimeoutMs: 20 });
    const statuses: string[] = [];
    await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
    const enable = fixture.manager.enable().catch(() => {});
    await fixture.waitForAttempts(1);
    const oldApns = fixture.nativeFixture.listeners.get('registration');
    const oldFcm = fixture.fcmFixture.listeners.get('tokenReceived');
    let storedToken: string | null = null;
    const session = new AuthSessionManager({
      get: async () => storedToken,
      set: async (value: string) => { storedToken = value; },
      remove: async () => { storedToken = null; },
    });
    await session.setToken('test-session');
    await fixture.manager.beforeLogout();
    await session.clearToken(); // This is the same order used by AppContext.logout.
    assert.equal(await session.getToken(), null);
    assert.equal(storedToken, null);
    assert.deepEqual(fixture.deactivationGenerations, [1]);
    assert.equal(fixture.generationState.value, 2);
    assert.equal(storage.get('veli.ios.push-cleanup-pending'), '1');
    assert(fixture.nativeFixture.events.includes('backend-deactivate'));
    assert(fixture.nativeFixture.events.includes('delete-instance'));
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, (status) => statuses.push(status));
    await waitForStatus(statuses, 'unavailable');
    assert.equal(fixture.registrationAttempts(), 1, 'new account cannot register while old request is unsettled');
    release();
    await enable;
    oldApns?.({ value: 'late-apns-callback' } as never);
    oldFcm?.({ token: 'late-old-account-fcm-token-123456' } as never);
    await Promise.resolve();
    assert.equal(fixture.registrationAttempts(), 1);
    assert.equal(statuses.at(-1), 'unavailable');
    assert.equal(await fixture.manager.enable(), 'ready');
    assert.equal(fixture.registrationAttempts(), 2);
    assert.deepEqual(fixture.registrationGenerations, [1, 2]);
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testFailedCleanupStillFinishesLogoutAndRetriesOnNextLaunch() {
  await withPushStorage(async (storage) => {
    const first = createManager({ initialPermission: 'granted', failDeactivation: true, activationTimeoutMs: 20 });
    const firstStatuses: string[] = [];
    await first.manager.start('ios-parent', 'parent', () => {}, (status) => firstStatuses.push(status));
    await waitForStatus(firstStatuses, 'ready');
    const deleteInstance = first.fcmFixture.fcm.deleteInstance;
    first.fcmFixture.fcm.deleteInstance = async () => { throw new Error('native cleanup unavailable'); };
    await first.manager.beforeLogout();
    assert.equal(storage.get('veli.ios.push-cleanup-pending'), '1');
    assert(first.nativeFixture.events.includes('backend-deactivate'));
    const next = createManager({ activationTimeoutMs: 20, generationState: first.generationState });
    const statuses: string[] = [];
    next.fcmFixture.fcm.deleteInstance = async () => { throw new Error('still unavailable'); };
    await next.manager.start('ios-teacher', 'teacher', () => {}, (status) => statuses.push(status));
    assert.equal(statuses.at(-1), 'off');
    await expectActivationStage(next.manager.enable(), 'cleanup-fcm-delete');
    assert.equal(next.nativeFixture.requestCount(), 1, 'permission is requested before cleanup recovery, but no token is registered');
    assert.equal(next.registrationAttempts(), 0);
    next.fcmFixture.fcm.deleteInstance = deleteInstance;
    assert.equal(await next.manager.enable(), 'ready');
    assert.deepEqual(next.registrationGenerations, [2]);
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false);
    await next.manager.afterSessionInvalidated();
  });
}

async function testBackendDeactivationFailureAllowsGuardedNextRegistration() {
  await withPushStorage(async (storage) => {
    const fixture = createManager({ failDeactivation: true, activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    assert.equal(await fixture.manager.enable(), 'ready');
    await fixture.manager.beforeLogout();
    assert.equal(storage.get('veli.ios.push-cleanup-pending'), '1');
    const statuses: string[] = [];
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, (status) => statuses.push(status));
    await waitForStatus(statuses, 'ready');
    assert.equal(fixture.registrationAttempts(), 2);
    assert.deepEqual(fixture.registrationGenerations, [1, 2]);
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testAccountSwitchQuarantinesLateRegistration() {
  await withPushStorage(async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fixture = createManager({ registrationGates: [gate, Promise.resolve()], activationTimeoutMs: 20 });
    const statuses: string[] = [];
    await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
    const oldEnable = fixture.manager.enable().catch(() => {});
    await fixture.waitForAttempts(1);
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, (status) => statuses.push(status));
    await waitForStatus(statuses, 'unavailable');
    assert.equal(fixture.registrationAttempts(), 1);
    release();
    await oldEnable;
    assert.equal(statuses.at(-1), 'unavailable');
    assert.equal(await fixture.manager.enable(), 'ready');
    assert.equal(fixture.registrationAttempts(), 2);
    assert.deepEqual(fixture.registrationGenerations, [1, 2]);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testRegistrationGenerationSurvivesAppRestart() {
  await withPushStorage(async (storage) => {
    const first = createManager({ persistentIdentity: true, activationTimeoutMs: 20 });
    await first.manager.start('ios-parent', 'parent', () => {}, () => {});
    assert.equal(await first.manager.enable(), 'ready');
    const installationId = first.registrationInstallations[0];
    assert.deepEqual(first.registrationGenerations, [1]);
    await first.manager.beforeLogout();
    assert.equal(storage.get('veli.ios.registration-generation'), '2');

    const reopened = createManager({ persistentIdentity: true, activationTimeoutMs: 20 });
    await reopened.manager.start('ios-teacher', 'teacher', () => {}, () => {});
    assert.equal(await reopened.manager.enable(), 'ready');
    assert.equal(reopened.registrationInstallations[0], installationId);
    assert.deepEqual(reopened.registrationGenerations, [2]);
    await reopened.manager.afterSessionInvalidated();
  });
}

async function testIosEmptyDeleteResponseAllowsNextLoginToEnablePush() {
  await withPushStorage(async (storage) => {
    const fixture = createManager({ persistentIdentity: true, activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    assert.equal(await fixture.manager.enable(), 'ready');
    await fixture.manager.beforeLogout();
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false, 'empty iOS delete response completes cleanup');
    const nextStatuses: string[] = [];
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, (status) => nextStatuses.push(status));
    await waitForStatus(nextStatuses, 'ready');
    assert.equal(nextStatuses.at(-1), 'ready', 'next login can enable notifications');
    assert.deepEqual(fixture.registrationGenerations, [1, 2]);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testNeverEnabledLogoutDoesNotCreateCleanupBarrier() {
  await withPushStorage(async (storage) => {
    const fixture = createManager({ persistentIdentity: true, activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    fixture.nativeFixture.native.unregister = async () => { throw new Error('must not unregister an unused device'); };
    fixture.fcmFixture.fcm.deleteInstance = async () => { throw new Error('must not delete an unused Firebase instance'); };
    await fixture.manager.beforeLogout();
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false);
    assert.deepEqual(fixture.deactivationGenerations, [1], 'logout still creates the backend tombstone');
    assert(!fixture.nativeFixture.events.includes('native-unregister'));
    assert(!fixture.nativeFixture.events.includes('delete-instance'));
    const native = createNative().native;
    fixture.nativeFixture.native.unregister = native.unregister;
    const fcm = createFcm(fixture.nativeFixture.events).fcm;
    fixture.fcmFixture.fcm.deleteInstance = fcm.deleteInstance;
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, () => {});
    assert.equal(await fixture.manager.enable(), 'ready');
    assert.deepEqual(fixture.registrationGenerations, [2]);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testCleanupFailuresAreClassifiedAfterPermissionWithoutRegistration() {
  await withPushStorage(async (storage) => {
    storage.set('veli.ios.push-cleanup-pending', '1');
    const fixture = createManager({ activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    const unregister = fixture.nativeFixture.native.unregister;
    fixture.nativeFixture.native.unregister = async () => { throw { code: 'UNAVAILABLE', message: 'sensitive-value' }; };
    await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
      && error.stage === 'cleanup-unregister' && error.kind === 'plugin-unavailable'
      && !error.message.includes('sensitive-value') && !error.userMessage.includes('sensitive-value'));
    assert.equal(fixture.nativeFixture.requestCount(), 1, 'permission request precedes cleanup recovery');
    assert.equal(fixture.registrationAttempts(), 0);
    assert(!fixture.nativeFixture.events.includes('native-register'));
    fixture.nativeFixture.native.unregister = unregister;
    const deleteInstance = fixture.fcmFixture.fcm.deleteInstance;
    fixture.fcmFixture.fcm.deleteInstance = async () => { throw new Error('sensitive-value'); };
    await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
      && error.stage === 'cleanup-fcm-delete' && error.kind === 'rejected'
      && !error.message.includes('sensitive-value') && !error.userMessage.includes('sensitive-value'));
    assert.equal(fixture.registrationAttempts(), 0);
    fixture.fcmFixture.fcm.deleteInstance = deleteInstance;
    assert.equal(await fixture.manager.enable(), 'ready');
    assert.equal(storage.has('veli.ios.push-cleanup-pending'), false);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testStuckNativeCleanupIsSingleFlightAcrossRetry() {
  await withPushStorage(async (storage) => {
    storage.set('veli.ios.push-cleanup-pending', '1');
    const fixture = createManager({ activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    let release!: () => void;
    let calls = 0;
    fixture.nativeFixture.native.unregister = async () => {
      calls++;
      await new Promise<void>((resolve) => { release = resolve; });
    };
    await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
      && error.stage === 'cleanup-unregister' && error.kind === 'timeout');
    await expectActivationStage(fixture.manager.enable(), 'cleanup-unregister');
    assert.equal(calls, 1, 'timed-out unregister must not overlap with a second native unregister');
    assert.equal(fixture.registrationAttempts(), 0);
    fixture.nativeFixture.native.unregister = async () => {};
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await fixture.manager.enable(), 'ready');
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testLogoutCleanupCannotOverlapDifferentAccountRegistration() {
  await withPushStorage(async (storage) => {
    const fixture = createManager({ initialPermission: 'granted', activationTimeoutMs: 20 });
    const statuses: string[] = [];
    await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
    await waitForStatus(statuses, 'ready');
    let release!: () => void;
    let calls = 0;
    fixture.nativeFixture.native.unregister = async () => {
      calls++;
      await new Promise<void>((resolve) => { release = resolve; });
    };
    await fixture.manager.beforeLogout();
    assert.equal(storage.get('veli.ios.push-cleanup-pending'), '1');
    await fixture.manager.start('ios-teacher', 'teacher', () => {}, (status) => statuses.push(status));
    await waitForStatus(statuses, 'unavailable');
    await expectActivationStage(fixture.manager.enable(), 'cleanup-unregister');
    assert.equal(calls, 1, 'new account must await the old native unregister');
    assert.equal(fixture.registrationAttempts(), 1, 'new account cannot register before cleanup settles');
    fixture.nativeFixture.native.unregister = async () => {};
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await fixture.manager.enable(), 'ready');
    assert.deepEqual(fixture.registrationGenerations, [1, 2]);
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testEveryListenerFailureIsDistinctAndRetryable() {
  const cases = [
    { event: 'tokenReceived', stage: 'listener-fcm-token', firebase: true },
    { event: 'registration', stage: 'listener-apns-registration', firebase: false },
    { event: 'registrationError', stage: 'listener-apns-error', firebase: false },
    { event: 'pushNotificationReceived', stage: 'listener-notification-received', firebase: false },
  ] as const;
  for (const testCase of cases) {
    const fixture = createManager({ activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    const target = testCase.firebase ? fixture.fcmFixture.fcm : fixture.nativeFixture.native;
    const original = target.addListener;
    (target as { addListener: typeof original }).addListener = async (name, listener) => {
      if (name === testCase.event) throw { code: 'UNIMPLEMENTED', message: 'sensitive-value' };
      return original(name as never, listener as never);
    };
    await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
      && error.stage === testCase.stage && error.kind === 'plugin-unavailable'
      && !error.userMessage.includes('sensitive-value'));
    assert.equal(fixture.registrationAttempts(), 0);
    assert.equal(fixture.nativeFixture.listeners.size, 0, 'partial listeners must be removed');
    assert.equal(fixture.fcmFixture.listeners.size, 0, 'partial FCM listeners must be removed');
    (target as { addListener: typeof original }).addListener = original;
    assert.equal(await fixture.manager.enable(), 'ready');
    await fixture.manager.afterSessionInvalidated();
  }
}

async function testGrantedStartupListenerFailureRemainsRetryable() {
  const fixture = createManager({ initialPermission: 'granted', activationTimeoutMs: 20 });
  const statuses: string[] = [];
  const addListener = fixture.nativeFixture.native.addListener;
  fixture.nativeFixture.native.addListener = async (name, listener) => {
    if (name === 'registration') throw new Error('sensitive-value');
    return addListener(name, listener);
  };
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await waitForStatus(statuses, 'unavailable');
  assert.equal(fixture.registrationAttempts(), 0);
  fixture.nativeFixture.native.addListener = addListener;
  assert.equal(await fixture.manager.enable(), 'ready');
  await fixture.manager.afterSessionInvalidated();
}

async function testTimedOutListenerCannotAttachAfterRetry() {
  const fixture = createManager({ activationTimeoutMs: 20 });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  const addListener = fixture.nativeFixture.native.addListener;
  let resolveLate!: (handle: { remove: () => Promise<void> }) => void;
  let lateHandleRemoved = false;
  fixture.nativeFixture.native.addListener = async (name, listener) => {
    if (name === 'registration') return new Promise((resolve) => { resolveLate = resolve; });
    return addListener(name, listener);
  };
  await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
    && error.stage === 'listener-apns-registration' && error.kind === 'timeout');
  assert.equal(fixture.registrationAttempts(), 0);
  fixture.nativeFixture.native.addListener = addListener;
  assert.equal(await fixture.manager.enable(), 'ready');
  resolveLate({ remove: async () => { lateHandleRemoved = true; } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(lateHandleRemoved, true, 'late listener handle must be removed after the timed-out attempt');
  assert.equal(fixture.nativeFixture.listeners.has('registration'), true, 'current listener must survive old handle cleanup');
  await fixture.manager.afterSessionInvalidated();
}

async function testCleanupMarkerStorageFailureIsDistinct() {
  await withPushStorage(async () => {
    const fixture = createManager({ activationTimeoutMs: 20 });
    await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
    const getItem = localStorage.getItem.bind(localStorage);
    localStorage.getItem = (key: string) => {
      if (key === 'veli.ios.push-cleanup-pending') throw new Error('sensitive-value');
      return getItem(key);
    };
    await assert.rejects(fixture.manager.enable(), (error: unknown) => error instanceof IosPushActivationError
      && error.stage === 'cleanup-marker' && error.kind === 'storage-unavailable'
      && !error.userMessage.includes('sensitive-value'));
    assert.equal(fixture.nativeFixture.requestCount(), 1);
    assert.equal(fixture.registrationAttempts(), 0);
    localStorage.getItem = getItem;
    assert.equal(await fixture.manager.enable(), 'ready');
    await fixture.manager.afterSessionInvalidated();
  });
}

async function testNavigationListenerFailureIsClassified() {
  const fixture = createManager({ activationTimeoutMs: 20 });
  const addListener = fixture.nativeFixture.native.addListener;
  fixture.nativeFixture.native.addListener = async (name, listener) => {
    if (name === 'pushNotificationActionPerformed') throw { code: 'UNAVAILABLE', message: 'sensitive-value' };
    return addListener(name, listener);
  };
  await assert.rejects(fixture.manager.startNavigationCapture(async () => 'session'), (error: unknown) => error instanceof IosPushActivationError
    && error.stage === 'listener-notification-action' && error.kind === 'plugin-unavailable'
    && !error.userMessage.includes('sensitive-value'));
  fixture.nativeFixture.native.addListener = addListener;
  await fixture.manager.startNavigationCapture(async () => 'session');
  await fixture.manager.stopNavigationCapture();
}

async function testLogoutOverlapsBackendRevocationAndStuckRegistration() {
  const never = new Promise<void>(() => {});
  const fixture = createManager({ registrationGate: never, deactivationGate: never, activationTimeoutMs: 80 });
  await fixture.manager.start('ios-parent', 'parent', () => {}, () => {});
  const enable = fixture.manager.enable().catch(() => {});
  await fixture.waitForAttempts(1);
  const started = performance.now();
  const logout = fixture.manager.beforeLogout();
  await Promise.resolve();
  await Promise.resolve();
  assert(fixture.nativeFixture.events.includes('backend-deactivate'), 'revocation starts while old POST remains unsettled');
  await logout;
  const elapsed = performance.now() - started;
  assert(elapsed < 150, `parallel cleanup exceeded a single timeout window: ${Math.round(elapsed)} ms`);
  await enable;
  console.log(`iOS logout stuck-request fixture: ${Math.round(elapsed)} ms with 80 ms stage timeout.`);
}

async function testLogoutClearsAuthAfterBoundedPushCleanup() {
  const source = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
  assert.match(source, /const logout = async \(\) => \{\s*await mobilePush\.beforeLogout\(\);\s*await authSession\.clearToken\(\);/);
  const navbar = readFileSync(new URL('../src/components/Navbar.tsx', import.meta.url), 'utf8');
  assert.match(navbar, /title="Hesabım" dismissible=\{!isLoggingOut\}/, 'logout keeps the account modal open until cleanup completes');
  assert.match(navbar, /isLoggingOut \? <p role="status"[^>]*>Oturum kapatılıyor…<\/p> : <>/, 'push status must be hidden while logging out');
  assert.match(navbar, /\.catch\(\(\) => \{\s*setLogoutError\([^)]*\);\s*\}\)\.finally\(\(\) => setIsLoggingOut\(false\)\)/, 'failed logout restores the button');
}

async function testLogoutDoesNotWaitForeverForNativeCleanup() {
  const fixture = createManager({ initialPermission: 'granted', activationTimeoutMs: 20 });
  const statuses: string[] = [];
  await fixture.manager.start('ios-parent', 'parent', () => {}, (status) => statuses.push(status));
  await waitForStatus(statuses, 'ready');
  fixture.nativeFixture.native.unregister = async () => new Promise<never>(() => {});
  await fixture.manager.beforeLogout();
  assert(fixture.nativeFixture.events.includes('backend-deactivate'));
  assert(fixture.nativeFixture.events.includes('delete-instance'));
}

async function run() {
  await testCapacitorPluginProxyIsNotAwaited();
  await testIosPermissionAndTokenLifecycle();
  await testIosDeniedAndSettings();
  await testReconnectRetryKeepsFcmTokenInMemory();
  await testNavigationAndPlatformGuards();
  await testLogoutWaitsForInFlightRegistration();
  await testPermissionRevocationWaitsForRegistration();
  await testTimedOutPermissionCallsCanRetry();
  await testTimedOutApnsAndFcmStages();
  await testTimedOutBackendRegistrationDoesNotReportReady();
  await testLateFirstBackendResultCannotCompleteOverlappingRetry();
  await testLateFcmLookupCannotDowngradeReadyRegistration();
  await testGrantedPermissionWithoutApnsCallbackDoesNotStayPreparing();
  await testDeferredPromptKeepsEnableActionAvailable();
  await testPermissionRevocationWaitsForBackendDeactivation();
  await testUnconfirmedDeactivationIsNotReportedAsOff();
  await testStuckRegistrationDoesNotBlockLogoutOrBindNextAccount();
  await testFailedCleanupStillFinishesLogoutAndRetriesOnNextLaunch();
  await testBackendDeactivationFailureAllowsGuardedNextRegistration();
  await testAccountSwitchQuarantinesLateRegistration();
  await testRegistrationGenerationSurvivesAppRestart();
  await testIosEmptyDeleteResponseAllowsNextLoginToEnablePush();
  for (const [name, test] of [
    ['never-enabled logout', testNeverEnabledLogoutDoesNotCreateCleanupBarrier],
    ['classified cleanup', testCleanupFailuresAreClassifiedAfterPermissionWithoutRegistration],
    ['single-flight cleanup', testStuckNativeCleanupIsSingleFlightAcrossRetry],
    ['cross-account cleanup', testLogoutCleanupCannotOverlapDifferentAccountRegistration],
    ['listener stages', testEveryListenerFailureIsDistinctAndRetryable],
    ['granted startup listener', testGrantedStartupListenerFailureRemainsRetryable],
    ['timed-out listener', testTimedOutListenerCannotAttachAfterRetry],
    ['cleanup marker', testCleanupMarkerStorageFailureIsDistinct],
    ['navigation listener', testNavigationListenerFailureIsClassified],
  ] as const) {
    try { await test(); } catch (error) { console.error(`iOS push regression case failed: ${name}`); throw error; }
  }
  await testLogoutOverlapsBackendRevocationAndStuckRegistration();
  await testLogoutClearsAuthAfterBoundedPushCleanup();
  await testLogoutDoesNotWaitForeverForNativeCleanup();
  console.log('iOS push token, permission, lifecycle, logout, navigation and web guard tests passed.');
}

run().catch((error) => {
  console.error(error instanceof assert.AssertionError ? `iOS push assertion failed at ${error.stack?.split('\n').find((line) => /^\s+at /.test(line))?.trim()}` : error instanceof IosPushActivationError ? `iOS push activation failed at ${error.stage}` : `iOS push tests failed at ${error instanceof Error ? error.stack?.split('\n')[1]?.trim() : 'unknown location'}.`);
  process.exitCode = 1;
});
