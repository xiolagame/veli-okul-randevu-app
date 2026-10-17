import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { IosPushManager } from '../src/platform/ios-push';
import { canUseAndroidPush, canUseMobilePush } from '../src/platform/push-eligibility';
import { pendingNavigationIntent } from '../src/platform/navigation-intent';

type Listener = (event: never) => void;

function createNative(permission: 'prompt' | 'granted' | 'denied' = 'prompt') {
  const events: string[] = [];
  const listeners = new Map<string, Listener>();
  let currentPermission = permission;
  let requestCount = 0;
  const fire = (name: string, event: unknown) => listeners.get(name)?.(event as never);
  const native = {
    addListener: async (name: string, listener: Listener) => {
      listeners.set(name, listener);
      return { remove: async () => { listeners.delete(name); } };
    },
    checkPermissions: async () => ({ receive: currentPermission }),
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
    setPermission: (value: 'prompt' | 'granted' | 'denied') => { currentPermission = value; },
  };
}

function createFcm(events: string[], token = 'fcm-registration-token-initial-123456') {
  const listeners = new Map<string, Listener>();
  const fcm = {
    addListener: async (name: string, listener: Listener) => {
      listeners.set(name, listener);
      return { remove: async () => { listeners.delete(name); } };
    },
    getToken: async () => ({ token }),
    setAutoInit: async ({ enabled }: { enabled: boolean }) => { events.push(`auto-init-${enabled}`); },
    deleteInstance: async () => { events.push('delete-instance'); return true; },
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
} = {}) {
  const nativeFixture = createNative(options.initialPermission);
  const fcmFixture = createFcm(nativeFixture.events);
  const registrations: Array<{ platform: string; provider: string; providerTarget: string }> = [];
  const lifecycle: string[] = [];
  let registrationAttempts = 0;
  let settingsOpened = 0;
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
      registrationAttempts++;
      for (const waiter of [...attemptWaiters]) waiter();
      nativeFixture.events.push('backend-register');
      if (options.registrationGate) await options.registrationGate;
      if (options.failFirstRegistration && registrationAttempts === 1) throw new Error('offline');
      registrations.push({ platform: input.platform, provider: input.provider, providerTarget: input.providerTarget });
    },
    deactivatePushDevice: async () => { nativeFixture.events.push('backend-deactivate'); },
  }, () => options.platform || 'IOS', () => crypto.randomUUID(),
  nativeFixture.native as unknown as ConstructorParameters<typeof IosPushManager>[3],
  fcmFixture.fcm as unknown as ConstructorParameters<typeof IosPushManager>[4],
  async () => { settingsOpened++; });
  return {
    manager, nativeFixture, fcmFixture, registrations, lifecycle,
    registrationAttempts: () => registrationAttempts,
    waitForAttempts,
    settingsOpened: () => settingsOpened,
  };
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
  assert.equal(statuses.at(-1), 'unavailable');
  await fixture.manager.refreshPermission();
  assert.equal(fixture.registrationAttempts(), 2);
  assert.equal(fixture.registrations.at(-1)?.providerTarget, 'fcm-registration-token-initial-123456');
  assert.equal(statuses.at(-1), 'ready');
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

async function run() {
  await testIosPermissionAndTokenLifecycle();
  await testIosDeniedAndSettings();
  await testReconnectRetryKeepsFcmTokenInMemory();
  await testNavigationAndPlatformGuards();
  await testLogoutWaitsForInFlightRegistration();
  await testPermissionRevocationWaitsForRegistration();
  console.log('iOS push token, permission, lifecycle, logout, navigation and web guard tests passed.');
}

run().catch((error) => {
  console.error(error instanceof assert.AssertionError ? `iOS push assertion failed: ${error.message}` : 'iOS push tests failed.');
  process.exitCode = 1;
});
