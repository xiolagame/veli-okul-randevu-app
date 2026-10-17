import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import type { PushNotificationsPlugin } from '@capacitor/push-notifications';
import { AndroidPushManager } from '../src/platform/android-push';
import { canUseAndroidPush } from '../src/platform/push-eligibility';
import { parseNavigationIntent, pendingNavigationIntent, PendingNavigationIntentStore } from '../src/platform/navigation-intent';
import { AppointmentNavigationResolver } from '../src/platform/appointment-navigation';
import { runScheduledAppointmentJobs } from '../server/scheduled-appointment-jobs';

async function testScheduledJobIsolation() {
  const reminderResult = { eligible: 1, sent: 1, failed: 0, skipped: 0 };
  const pushResult = { claimed: 1, sent: 1, failed: 0, invalid: 0, unavailable: 0 };
  const events: string[] = [];

  await assert.rejects(() => runScheduledAppointmentJobs({
    runReminders: async () => { events.push('reminder-failed'); throw new Error('fixture'); },
    dispatchPush: async () => { events.push('push-ran'); return pushResult; },
    log: (message) => events.push(message),
  }), /Appointment reminder job failed/);
  assert(events.includes('push-ran'));

  events.length = 0;
  assert.deepEqual(await runScheduledAppointmentJobs({
    runReminders: async () => { events.push('reminder-ran'); return reminderResult; },
    dispatchPush: async () => { events.push('push-failed'); throw new Error('fixture'); },
    log: (message) => events.push(message),
  }), reminderResult);
  assert(events.includes('reminder-ran'));

  events.length = 0;
  assert.deepEqual(await runScheduledAppointmentJobs({
    runReminders: async () => { events.push('reminder-ran'); return reminderResult; },
    dispatchPush: async () => { events.push('push-ran'); return pushResult; },
    log: (message) => events.push(message),
  }), reminderResult);
  assert(events.includes('reminder-ran') && events.includes('push-ran'));
}

async function testMultiSchoolAppointmentNavigation() {
  const appointmentId = 'appointment-target';
  const createStore = () => {
    const store = new PendingNavigationIntentStore();
    store.set({ type: 'APPOINTMENT', resourceId: appointmentId });
    return store;
  };

  const currentStore = createStore();
  const navigated: string[] = [];
  assert.equal(await new AppointmentNavigationResolver().resolve({
    store: currentStore, currentSchoolId: 'school-a', accessibleSchoolIds: ['school-a'],
    getAppointmentIds: async () => [appointmentId], switchSchool: async () => {},
    navigate: async (id) => { navigated.push(id); }, isCurrent: () => true,
  }), 'NAVIGATED');
  assert.deepEqual(navigated, [appointmentId]);
  assert.equal(currentStore.peek(), null);

  const multiStore = createStore();
  const switched: string[] = [];
  const resolver = new AppointmentNavigationResolver();
  assert.equal(await resolver.resolve({
    store: multiStore, currentSchoolId: 'school-a', accessibleSchoolIds: ['school-a', 'school-b'],
    getAppointmentIds: async (schoolId) => schoolId === 'school-b' ? [appointmentId] : [],
    switchSchool: async (schoolId) => { switched.push(schoolId); }, navigate: async () => {}, isCurrent: () => true,
  }), 'SWITCHED');
  assert.deepEqual(switched, ['school-b']);
  assert.equal(multiStore.peek()?.type, 'APPOINTMENT');
  assert.equal(await resolver.resolve({
    store: multiStore, currentSchoolId: 'school-b', accessibleSchoolIds: ['school-a', 'school-b'],
    getAppointmentIds: async (schoolId) => schoolId === 'school-b' ? [appointmentId] : [],
    switchSchool: async () => { throw new Error('unexpected switch'); }, navigate: async () => {}, isCurrent: () => true,
  }), 'NAVIGATED');
  assert.equal(multiStore.peek(), null);

  const networkStore = createStore();
  assert.equal(await new AppointmentNavigationResolver().resolve({
    store: networkStore, currentSchoolId: 'school-a', accessibleSchoolIds: ['school-a'],
    getAppointmentIds: async () => { throw new Error('network'); }, switchSchool: async () => {},
    navigate: async () => {}, isCurrent: () => true,
  }), 'PENDING');
  assert.equal(networkStore.peek()?.type, 'APPOINTMENT');

  const missingStore = createStore();
  const queried: string[] = [];
  assert.equal(await new AppointmentNavigationResolver().resolve({
    store: missingStore, currentSchoolId: 'school-a', accessibleSchoolIds: ['school-a', 'school-b'],
    getAppointmentIds: async (schoolId) => { queried.push(schoolId); return []; }, switchSchool: async () => {},
    navigate: async () => {}, isCurrent: () => true,
  }), 'CLEARED');
  assert.deepEqual(queried, ['school-a', 'school-b']);
  assert.equal(missingStore.peek(), null);

  const raceStore = createStore();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const raceResolver = new AppointmentNavigationResolver();
  const raceOptions = {
    store: raceStore, currentSchoolId: 'school-a', accessibleSchoolIds: ['school-a'],
    getAppointmentIds: async () => { requests++; await gate; return [appointmentId]; },
    switchSchool: async () => {}, navigate: async () => {}, isCurrent: () => true,
  };
  const first = raceResolver.resolve(raceOptions);
  const second = raceResolver.resolve(raceOptions);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['NAVIGATED', 'NONE']);
  assert.equal(requests, 1);
}

async function testAndroidClient() {
  const events: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let permission: 'denied' | 'granted' = 'denied';
  let registered = 0;
  let refreshed = 0;
  const native = {
    addListener: async (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return { remove: async () => { listeners.delete(name); } };
    },
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => { events.push('permission-request'); permission = 'granted'; return { receive: permission }; },
    createChannel: async () => { events.push('channel'); },
    register: async () => { registered++; events.push('native-register'); listeners.get('registration')?.({ value: 'fcm-test-token-long-enough' }); },
    unregister: async () => { events.push('native-unregister'); },
    removeAllDeliveredNotifications: async () => { events.push('delivered-clear'); },
  } as unknown as PushNotificationsPlugin;
  const deviceApi = {
    registerPushDevice: async () => { events.push('backend-register'); },
    deactivatePushDevice: async () => { events.push('backend-deactivate'); },
  };
  let notificationSettingsChecks = 0;
  let notificationSettingsOpens = 0;
  const enabledNotificationSettings = { areNotificationsEnabled: async () => {
    notificationSettingsChecks += 1;
    return { enabled: true };
  }, openNotificationSettings: async () => { notificationSettingsOpens += 1; } };
  const webManager = new AndroidPushManager(native, deviceApi, () => 'WEB', () => crypto.randomUUID(), enabledNotificationSettings);
  await webManager.start('user-web', 'parent', () => {}, () => {});
  assert.equal(listeners.size, 0);
  assert.equal(notificationSettingsChecks, 0);
  await webManager.openNotificationSettings();
  assert.equal(notificationSettingsOpens, 0, 'Web runtime must not call native notification settings');
  const manager = new AndroidPushManager(native, deviceApi, () => 'ANDROID', () => crypto.randomUUID(), enabledNotificationSettings);
  let sessionIdentity: string | null = 'teacher-session';
  await manager.startNavigationCapture(async () => sessionIdentity);
  await manager.start('user-security', 'security', () => {}, () => {});
  assert.equal(listeners.size, 1);
  await manager.start('user-teacher', 'teacher', () => { refreshed++; }, () => {});
  const attachedListenerCount = listeners.size;
  await manager.start('user-teacher', 'teacher', () => { refreshed++; }, () => {});
  assert.equal(listeners.size, attachedListenerCount);
  assert.equal(registered, 0);
  assert(!events.includes('permission-request'));
  assert.equal(await manager.enable(), 'ready');
  assert.equal(registered, 1);
  assert(events.indexOf('permission-request') < events.indexOf('channel'));
  assert(events.indexOf('channel') < events.indexOf('native-register'));
  await manager.openNotificationSettings();
  assert.equal(notificationSettingsOpens, 1, 'Android runtime must delegate to native notification settings');
  listeners.get('pushNotificationReceived')?.({});
  listeners.get('pushNotificationReceived')?.({});
  await Promise.resolve();
  assert.equal(refreshed, 1);
  let resolveNavigation!: () => void;
  let navigationDispatched = new Promise<void>((resolve) => { resolveNavigation = resolve; });
  const eventWindow = { dispatchEvent: () => { events.push('navigation'); resolveNavigation(); return true; } };
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: eventWindow });
  try {
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { route: 'https://evil.example/app/appointments/apt-1' } } });
    await Promise.resolve();
    assert.equal(pendingNavigationIntent.peek(), null);
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { route: '/app/appointments/apt-1' } } });
    await navigationDispatched;
    assert.equal(pendingNavigationIntent.take()?.type, 'APPOINTMENT');
    sessionIdentity = null;
    navigationDispatched = new Promise<void>((resolve) => { resolveNavigation = resolve; });
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { route: '/app/appointments/apt-logged-out' } } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(pendingNavigationIntent.peek(), null);
    assert.equal(events.filter((event) => event === 'navigation').length, 1);

    let releaseHydration!: () => void;
    const hydrationGate = new Promise<void>((resolve) => { releaseHydration = resolve; });
    await manager.startNavigationCapture(async () => { await hydrationGate; return 'cold-session'; });
    navigationDispatched = new Promise<void>((resolve) => { resolveNavigation = resolve; });
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { route: '/app/appointments/apt-cold' } } });
    assert.equal(pendingNavigationIntent.peek(), null);
    releaseHydration();
    await navigationDispatched;
    assert.equal(pendingNavigationIntent.take()?.type, 'APPOINTMENT');

    let identityRead = 0;
    await manager.startNavigationCapture(async () => ++identityRead === 1 ? 'old-session' : 'new-session');
    listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { route: '/app/appointments/apt-stale' } } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(pendingNavigationIntent.peek(), null);
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
  await manager.beforeLogout();
  assert(events.lastIndexOf('backend-deactivate') < events.lastIndexOf('native-unregister'));
  assert(events.includes('delivered-clear'));
  assert.equal(listeners.size, 1);
  await manager.stopNavigationCapture();
  assert.equal(listeners.size, 0);

  const reconnectListeners = new Map<string, (event: unknown) => void>();
  let reconnectRegistrations = 0;
  let backendAttempts = 0;
  let reconnectDeactivations = 0;
  let reconnectUnregisters = 0;
  let reconnectPermission: 'denied' | 'granted' = 'granted';
  let reconnectSystemEnabled = true;
  const reconnectNative = {
    addListener: async (name: string, listener: (event: unknown) => void) => {
      reconnectListeners.set(name, listener);
      return { remove: async () => { reconnectListeners.delete(name); } };
    },
    checkPermissions: async () => ({ receive: reconnectPermission }),
    requestPermissions: async () => ({ receive: reconnectPermission }),
    createChannel: async () => {},
    register: async () => {
      reconnectRegistrations += 1;
      reconnectListeners.get('registration')?.({ value: 'retry-fcm-token' });
    },
    unregister: async () => { reconnectUnregisters += 1; },
    removeAllDeliveredNotifications: async () => {},
  } as unknown as PushNotificationsPlugin;
  const reconnectStatuses: string[] = [];
  const reconnectManager = new AndroidPushManager(reconnectNative, {
    registerPushDevice: async () => {
      backendAttempts += 1;
      if (backendAttempts === 1) throw new Error('offline');
    },
    deactivatePushDevice: async () => { reconnectDeactivations += 1; },
  }, () => 'ANDROID', () => crypto.randomUUID(), {
    areNotificationsEnabled: async () => ({ enabled: reconnectSystemEnabled }),
    openNotificationSettings: async () => {},
  });
  await reconnectManager.start('reconnect-user', 'parent', () => {}, (status) => reconnectStatuses.push(status));
  assert.equal(backendAttempts, 1);
  assert.equal(reconnectStatuses.at(-1), 'unavailable');
  await reconnectManager.refreshPermission();
  assert.equal(backendAttempts, 2);
  assert.equal(reconnectRegistrations, 2);
  assert.equal(reconnectStatuses.at(-1), 'ready');
  reconnectPermission = 'denied';
  await reconnectManager.refreshPermission();
  assert.equal(reconnectStatuses.at(-1), 'off');
  reconnectPermission = 'granted';
  reconnectSystemEnabled = false;
  assert.equal(await reconnectManager.enable(), 'off');
  assert.equal(reconnectStatuses.at(-1), 'off');
  assert.equal(backendAttempts, 2);
  assert(reconnectDeactivations >= 2);
  assert(reconnectUnregisters >= 2);
  reconnectSystemEnabled = true;
  await reconnectManager.refreshPermission();
  assert.equal(backendAttempts, 3);
  assert.equal(reconnectStatuses.at(-1), 'ready');
  await reconnectManager.afterSessionInvalidated();
  assert.equal(reconnectListeners.size, 0);

  const unavailableStatuses: string[] = [];
  let unavailableDeactivations = 0;
  let unavailableUnregisters = 0;
  const unavailableManager = new AndroidPushManager({
    ...reconnectNative,
    unregister: async () => { unavailableUnregisters += 1; },
  } as PushNotificationsPlugin, {
    registerPushDevice: async () => { throw new Error('must not register'); },
    deactivatePushDevice: async () => { unavailableDeactivations += 1; },
  }, () => 'ANDROID', () => crypto.randomUUID(), {
    areNotificationsEnabled: async () => { throw new Error('native plugin unavailable'); },
    openNotificationSettings: async () => { throw new Error('settings unavailable'); },
  });
  await unavailableManager.start('unavailable-user', 'teacher', () => {}, (status) => unavailableStatuses.push(status));
  assert.equal(unavailableStatuses.at(-1), 'unavailable');
  assert.equal(unavailableDeactivations, 1);
  assert.equal(unavailableUnregisters, 1);
  await assert.rejects(() => unavailableManager.openNotificationSettings(), /settings unavailable/);
  await unavailableManager.afterSessionInvalidated();

  const cleanupListeners = new Map<string, (event: unknown) => void>();
  let releaseCleanup!: () => void;
  let markCleanupStarted!: () => void;
  const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  const cleanupStarted = new Promise<void>((resolve) => { markCleanupStarted = resolve; });
  let cleanupRegistrations = 0;
  const cleanupNative = {
    addListener: async (name: string, listener: (event: unknown) => void) => {
      cleanupListeners.set(name, listener);
      return { remove: async () => { cleanupListeners.delete(name); } };
    },
    checkPermissions: async () => ({ receive: 'granted' as const }),
    requestPermissions: async () => ({ receive: 'granted' as const }),
    createChannel: async () => {},
    register: async () => { cleanupListeners.get('registration')?.({ value: 'cleanup-race-token' }); },
    unregister: async () => { markCleanupStarted(); await cleanupGate; },
    removeAllDeliveredNotifications: async () => {},
  } as unknown as PushNotificationsPlugin;
  const cleanupManager = new AndroidPushManager(cleanupNative, {
    registerPushDevice: async () => { cleanupRegistrations += 1; },
    deactivatePushDevice: async () => {},
  }, () => 'ANDROID', () => crypto.randomUUID(), enabledNotificationSettings);
  await cleanupManager.start('old-account', 'teacher', () => {}, () => {});
  assert.equal(cleanupRegistrations, 1);
  const staleCleanup = cleanupManager.afterSessionInvalidated();
  await cleanupStarted;
  const newSessionStart = cleanupManager.start('new-account', 'parent', () => {}, () => {});
  await Promise.resolve();
  assert.equal(cleanupRegistrations, 1);
  releaseCleanup();
  await Promise.all([staleCleanup, newSessionStart]);
  assert.equal(cleanupRegistrations, 2);
  await cleanupManager.beforeLogout();

  permission = 'granted';
  const raceEvents: string[] = [];
  let release!: () => void;
  const blockedRegistration = new Promise<void>((resolve) => { release = resolve; });
  const raceManager = new AndroidPushManager(native, {
    registerPushDevice: async () => { raceEvents.push('register-start'); await blockedRegistration; raceEvents.push('register-end'); },
    deactivatePushDevice: async () => { raceEvents.push('deactivate'); },
  }, () => 'ANDROID', () => crypto.randomUUID(), enabledNotificationSettings);
  await raceManager.start('user-parent', 'parent', () => {}, () => {});
  const logout = raceManager.beforeLogout();
  assert.equal(raceEvents.includes('deactivate'), false);
  release();
  await logout;
  assert.deepEqual(raceEvents, ['register-start', 'register-end', 'deactivate']);

  const failingNative = { ...native, unregister: async () => { throw Error('test'); } } as PushNotificationsPlugin;
  const failingManager = new AndroidPushManager(failingNative, {
    registerPushDevice: async () => {}, deactivatePushDevice: async () => { throw Error('test'); },
  }, () => 'ANDROID', () => crypto.randomUUID(), enabledNotificationSettings);
  await failingManager.start('user-parent', 'parent', () => {}, () => {});
  await assert.rejects(() => failingManager.beforeLogout());
}

async function run() {
  await testScheduledJobIsolation();
  await testMultiSchoolAppointmentNavigation();
  await testAndroidClient();
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite is required.');
  process.env.NODE_ENV = 'test';
  const { getDb } = await import('../server/database/postgres');
  const { createToken } = await import('../server/auth');
  const { apiRouter } = await import('../server/api');
  const { createPushPayload, dispatchPushDeliveries, enqueueAppointmentPush, FirebasePushProvider,
    getSafeFcmErrorCode, registerPushDevice, validDeviceInput } = await import('../server/push-notifications');
  const { notificationRepository } = await import('../server/repositories');
  const { hashSetupToken } = await import('../server/activation-codes');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const pushTables = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('mobile_push_devices','notification_deliveries')`);
  assert.equal(pushTables.rows.length, 2);
  assert(pushTables.rows.every((table) => table.relrowsecurity));
  const pushPolicies = await db.query<{ tablename: string; roles: string[] }>(
    `SELECT tablename,roles FROM pg_policies WHERE schemaname='public'
      AND tablename IN ('mobile_push_devices','notification_deliveries')`);
  assert.equal(pushPolicies.rows.length, 2);
  assert(pushPolicies.rows.every((policy) => policy.roles.includes('service_role')));
  const suffix = crypto.randomUUID();
  const schoolId = `push-school-${suffix}`;
  const otherSchoolId = `push-other-${suffix}`;
  const parentId = `push-parent-${suffix}`;
  const teacherId = `push-teacher-${suffix}`;
  const securityId = `push-security-${suffix}`;
  const profileId = `push-profile-${suffix}`;
  const appointmentId = `push-apt-${suffix}`;
  const installationId = crypto.randomUUID();
  const iosInstallationId = crypto.randomUUID();
  const otherInstallationId = crypto.randomUUID();
  const teacherTarget = `fcm-test-teacher-${suffix}`;
  const iosTeacherTarget = `fcm-test-ios-teacher-${suffix}`;
  const parentTarget = `fcm-test-parent-${suffix}`;
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const token = (userId: string, authVersion = 0) => createToken({ userId, phone: '+905551111111', auth_version: authVersion });
  async function request(method: string, path: string, userId?: string, body?: object, authVersion = 0) {
    const response = await fetch(baseUrl + path, { method,
      headers: { 'content-type': 'application/json', ...(userId ? { authorization: `Bearer ${token(userId, authVersion)}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const device = (id: string, providerTarget: string, platform: 'ANDROID' | 'IOS' = 'ANDROID', registrationGeneration?: number) => ({ installationId: id, platform, provider: 'FCM',
    targetKind: 'REGISTRATION_TOKEN', providerTarget, appId: 'com.velirandevu.app',
    ...(registrationGeneration === undefined ? {} : { registrationGeneration }) });
  const deliveryCount = async (notificationId: string) => Number((await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE notification_id=$1', [notificationId])).rows[0].count);
  try {
    assert.equal(canUseAndroidPush('parent', 'WEB'), false);
    assert.equal(canUseAndroidPush('security', 'ANDROID'), false);
    assert.equal(canUseAndroidPush('teacher', 'ANDROID'), true);
    assert.equal(parseNavigationIntent('/app/appointments/apt-123', 'https://velirandevu.com')?.type, 'APPOINTMENT');
    assert.equal(parseNavigationIntent('https://evil.example/app/appointments/apt-123', 'https://velirandevu.com'), null);
    const payload = createPushPayload('APPOINTMENT_REQUESTED', appointmentId, 'notif-safe');
    assert.deepEqual(Object.keys(payload.data).sort(), ['eventType', 'notificationId', 'resourceId', 'resourceType', 'route']);
    for (const forbidden of ['qr', 'phone', 'email', 'birth', 'notes', 'student', 'parent', 'license', 'activation', 'reset', 'jwt', 'password']) {
      assert(!JSON.stringify(payload).toLowerCase().includes(forbidden));
    }
    assert.equal(getSafeFcmErrorCode({ errorInfo: { code: 'messaging/mismatched-credential' } }),
      'messaging/mismatched-credential');
    assert.equal(getSafeFcmErrorCode({ code: 'app/invalid-credential' }), 'app/invalid-credential');
    assert.equal(getSafeFcmErrorCode({ status: 403 }), 'HTTP_403');
    assert.equal(getSafeFcmErrorCode({ errorInfo: { code: 'unsafe code\nTOKEN=value' } }), 'UNKNOWN_FCM_ERROR');
    assert.equal(getSafeFcmErrorCode({ code: 'A'.repeat(256) }).length, 128);
    const unknownErrorCode = getSafeFcmErrorCode(new Error('SECRET TOKEN abc123'));
    assert.equal(unknownErrorCode, 'UNKNOWN_FCM_ERROR');
    assert(!unknownErrorCode.includes('SECRET') && !unknownErrorCode.includes('TOKEN'));
    assert.deepEqual(await new FirebasePushProvider(async () => {
      throw { errorInfo: { code: 'messaging/registration-token-not-registered' } };
    }).send(teacherTarget, payload), { status: 'INVALID_TARGET' });
    assert.deepEqual(await new FirebasePushProvider(async () => {
      throw { errorInfo: { code: 'messaging/mismatched-credential' } };
    }).send(teacherTarget, payload), {
      status: 'RETRYABLE_FAILURE', errorCode: 'messaging/mismatched-credential',
    });
    const previousProject = process.env.FCM_FIREBASE_PROJECT_ID;
    try {
      delete process.env.FCM_FIREBASE_PROJECT_ID;
      assert.equal((await new FirebasePushProvider().send(teacherTarget, payload)).status, 'CONFIG_NOT_AVAILABLE');
    } finally {
      if (previousProject !== undefined) process.env.FCM_FIREBASE_PROJECT_ID = previousProject;
    }

    for (const school of [schoolId, otherSchoolId]) {
      await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
        [school, 'Push Fixture', `P${crypto.randomBytes(7).toString('hex')}`, 'Test', 'Test']);
    }
    for (const [id, role, school] of [
      [parentId, 'parent', schoolId], [teacherId, 'teacher', schoolId], [securityId, 'security', schoolId],
    ]) {
      await db.query('INSERT INTO users(id,phone,first_name,last_name) VALUES($1,$2,$3,$4)',
        [id, `+905${crypto.randomInt(100000000, 999999999)}`, 'Push', 'Fixture']);
      await db.query('INSERT INTO school_memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',
        [`mem-${id}`, school, id, role]);
    }
    await db.query(`INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch)
      VALUES($1,$2,$3,'Push','Teacher','Test')`, [profileId, schoolId, teacherId]);
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,
      parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code)
      VALUES($1,$2,$3,'Push Teacher','Test',$4,'Push Parent','+905551111111','Test Student','5-A','2099-01-01','09:30','09:45','pending','123456')`,
    [appointmentId, schoolId, profileId, parentId]);

    assert.equal((await request('POST', '/api/mobile/push/devices', undefined, device(installationId, teacherTarget))).status, 401);
    assert.equal((await request('POST', '/api/mobile/push/devices', securityId, device(installationId, teacherTarget))).status, 403);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId, { ...device(installationId, teacherTarget), userId: parentId })).status, 400);
    const registered = await request('POST', '/api/mobile/push/devices', teacherId, device(installationId, teacherTarget));
    assert.equal(registered.status, 200);
    assert.deepEqual(Object.keys(registered.body), ['success']);
    assert(!JSON.stringify(registered.body).includes(teacherTarget));
    assert.equal(validDeviceInput(device(iosInstallationId, iosTeacherTarget, 'IOS')), true);
    assert.equal(validDeviceInput(device(iosInstallationId, iosTeacherTarget, 'IOS', 1)), true);
    assert.equal(validDeviceInput(device(iosInstallationId, iosTeacherTarget, 'IOS', 0)), false);
    assert.equal(validDeviceInput(device(installationId, teacherTarget, 'ANDROID', 1)), false);
    assert.equal(validDeviceInput({ ...device(iosInstallationId, iosTeacherTarget, 'IOS'), provider: 'APNS' }), false);
    const rawApnsTarget = 'a'.repeat(64);
    assert.equal(validDeviceInput(device(iosInstallationId, rawApnsTarget, 'IOS')), false);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      { ...device(iosInstallationId, iosTeacherTarget, 'IOS'), provider: 'APNS' })).status, 400);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(iosInstallationId, rawApnsTarget, 'IOS'))).status, 400);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(iosInstallationId, iosTeacherTarget, 'IOS'))).status, 200);
    const iosDevice = (await db.query<{ platform: string; provider: string }>(
      'SELECT platform,provider FROM mobile_push_devices WHERE installation_id=$1', [iosInstallationId])).rows[0];
    assert.deepEqual(iosDevice, { platform: 'IOS', provider: 'FCM' });

    // DELETE must fence a late POST, including when DELETE reached the server before any POST.
    const logoutRaceInstallationId = crypto.randomUUID();
    const logoutRaceOldTarget = `fcm-race-old-${suffix}`;
    const logoutRaceNewTarget = `fcm-race-new-${suffix}`;
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(logoutRaceInstallationId, logoutRaceOldTarget, 'IOS', 1))).status, 200);
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${logoutRaceInstallationId}?registrationGeneration=1`, teacherId)).status, 200);
    assert.equal((await db.query<{ active: boolean }>(
      'SELECT active FROM mobile_push_devices WHERE installation_id=$1', [logoutRaceInstallationId])).rows[0].active, false);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(logoutRaceInstallationId, logoutRaceOldTarget, 'IOS', 1))).status, 409);
    assert.equal((await db.query<{ active: boolean }>(
      'SELECT active FROM mobile_push_devices WHERE installation_id=$1', [logoutRaceInstallationId])).rows[0].active, false);
    assert.equal((await request('POST', '/api/mobile/push/devices', parentId,
      device(logoutRaceInstallationId, logoutRaceNewTarget, 'IOS', 2))).status, 200);
    assert.equal((await request('POST', '/api/mobile/push/devices', parentId,
      device(logoutRaceInstallationId, logoutRaceNewTarget, 'IOS', 2))).status, 200);
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${logoutRaceInstallationId}`, parentId)).status, 200);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(logoutRaceInstallationId, logoutRaceOldTarget, 'IOS', 1))).status, 409);
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${logoutRaceInstallationId}?registrationGeneration=1`, teacherId)).status, 200);
    assert.deepEqual((await db.query<{ user_id: string; active: boolean }>(
      'SELECT user_id,active FROM mobile_push_devices WHERE installation_id=$1', [logoutRaceInstallationId])).rows[0],
    { user_id: parentId, active: true });
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${logoutRaceInstallationId}?registrationGeneration=2`, parentId)).status, 200);

    const deleteFirstId = crypto.randomUUID();
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${deleteFirstId}?registrationGeneration=1`, teacherId)).status, 200);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(deleteFirstId, logoutRaceOldTarget, 'IOS', 1))).status, 409);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(deleteFirstId, logoutRaceOldTarget, 'IOS'))).status, 409);
    const deleteFirstTombstone = (await db.query<{ active: boolean; revoked_through_generation: string | number }>(
      'SELECT active,revoked_through_generation FROM mobile_push_devices WHERE installation_id=$1', [deleteFirstId])).rows[0];
    assert.equal(deleteFirstTombstone.active, false);
    assert.equal(Number(deleteFirstTombstone.revoked_through_generation), 1);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(deleteFirstId, logoutRaceOldTarget, 'IOS', 2))).status, 200);

    const concurrentId = crypto.randomUUID();
    const [concurrentPost, concurrentDelete] = await Promise.all([
      request('POST', '/api/mobile/push/devices', teacherId, device(concurrentId, logoutRaceOldTarget, 'IOS', 1)),
      request('DELETE', `/api/mobile/push/devices/${concurrentId}?registrationGeneration=1`, teacherId),
    ]);
    assert([200, 409].includes(concurrentPost.status));
    assert.equal(concurrentDelete.status, 200);
    assert.equal((await db.query<{ active: boolean }>(
      'SELECT active FROM mobile_push_devices WHERE installation_id=$1', [concurrentId])).rows[0].active, false);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId,
      device(concurrentId, logoutRaceOldTarget, 'IOS', 1))).status, 409);
    assert.equal((await request('POST', '/api/mobile/push/devices', teacherId, device(installationId, teacherTarget))).status, 200);
    assert.equal((await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM mobile_push_devices WHERE installation_id=$1',
      [installationId])).rows[0].count, '1');
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${installationId}`, parentId)).status, 200);
    assert.equal((await db.query<{ active: boolean }>('SELECT active FROM mobile_push_devices WHERE installation_id=$1',
      [installationId])).rows[0].active, true);

    const rollbackId = `notif-rollback-${suffix}`;
    await assert.rejects(() => db.transaction(async (tx) => {
      await notificationRepository.createNotification({ id: rollbackId, schoolId, userId: teacherId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: rollbackId, schoolId, userId: teacherId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      throw new Error('ROLLBACK');
    }));
    assert.equal((await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM notifications WHERE id=$1',
      [rollbackId])).rows[0].count, '0');

    const securityNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: securityId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: securityId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      return notification;
    });
    assert.equal(await deliveryCount(securityNotification.id), 0);

    const teacherNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: teacherId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: teacherId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: teacherId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      return notification;
    });
    assert.equal(await deliveryCount(teacherNotification.id), 2);
    await db.transaction((tx) => enqueueAppointmentPush(tx, { notificationId: teacherNotification.id,
      schoolId: otherSchoolId, userId: teacherId, appointmentId, eventType: 'APPOINTMENT_REQUESTED' }));
    assert.equal(await deliveryCount(teacherNotification.id), 2);
    let sent = 0;
    const success = await dispatchPushDeliveries({ send: async (_target, push) => {
      sent++;
      assert.equal(push.data.resourceId, appointmentId);
      return { status: 'SENT', messageId: 'fake-message' };
    } });
    assert.equal(success.sent, 2);
    assert.equal(sent, 2);
    assert.equal((await dispatchPushDeliveries({ send: async () => { throw Error('duplicate send'); } })).claimed, 0);

    const ownershipNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: teacherId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: teacherId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      return notification;
    });
    assert.equal(await deliveryCount(ownershipNotification.id), 2);
    await db.query('UPDATE teacher_profiles SET user_id=NULL WHERE id=$1', [profileId]);
    let foreignTeacherSends = 0;
    await dispatchPushDeliveries({ send: async () => { foreignTeacherSends++; return { status: 'SENT', messageId: 'unexpected' }; } });
    assert.equal(foreignTeacherSends, 0);
    assert.equal((await db.query<{ status: string }>('SELECT status FROM notification_deliveries WHERE notification_id=$1',
      [ownershipNotification.id])).rows[0].status, 'CANCELLED');
    await db.query('UPDATE teacher_profiles SET user_id=$2 WHERE id=$1', [profileId, teacherId]);

    assert.equal((await request('POST', '/api/mobile/push/devices', parentId, device(installationId, parentTarget))).status, 200);
    assert.equal((await db.query<{ user_id: string }>('SELECT user_id FROM mobile_push_devices WHERE installation_id=$1',
      [installationId])).rows[0].user_id, parentId);
    const afterRebind = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: teacherId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: teacherId,
        appointmentId, eventType: 'APPOINTMENT_REQUESTED' });
      return notification;
    });
    assert.equal(await deliveryCount(afterRebind.id), 1);

    const parentNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: parentId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: parentId,
        appointmentId, eventType: 'APPOINTMENT_APPROVED' });
      return notification;
    });
    assert.equal(await deliveryCount(parentNotification.id), 1);
    const invalid = await dispatchPushDeliveries({ send: async () => ({ status: 'INVALID_TARGET' }) });
    assert.equal(invalid.invalid, 2);
    assert.equal((await db.query<{ active: boolean }>('SELECT active FROM mobile_push_devices WHERE installation_id=$1',
      [installationId])).rows[0].active, false);
    assert.equal(await registerPushDevice(parentId, device(otherInstallationId, parentTarget)), true);
    assert.equal(await registerPushDevice(teacherId, device(otherInstallationId, teacherTarget)), true);
    assert.equal((await db.query<{ user_id: string }>('SELECT user_id FROM mobile_push_devices WHERE installation_id=$1',
      [otherInstallationId])).rows[0].user_id, teacherId);
    assert.equal(await registerPushDevice(parentId, device(otherInstallationId, parentTarget)), true);
    assert.equal((await db.query<{ user_id: string }>('SELECT user_id FROM mobile_push_devices WHERE installation_id=$1',
      [otherInstallationId])).rows[0].user_id, parentId);
    const retryNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: parentId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: parentId,
        appointmentId, eventType: 'APPOINTMENT_REJECTED' });
      return notification;
    });
    const safeRetryCode = 'messaging/mismatched-credential';
    assert.equal((await dispatchPushDeliveries({
      send: async () => ({ status: 'RETRYABLE_FAILURE', errorCode: safeRetryCode }),
    })).failed, 1);
    const failedDelivery = (await db.query<{ status: string; attempt_count: number; last_error_code: string;
      next_attempt_at: string; last_attempt_at: string }>(
      `SELECT status,attempt_count,last_error_code,next_attempt_at,last_attempt_at
       FROM notification_deliveries WHERE notification_id=$1`, [retryNotification.id])).rows[0];
    assert.equal(failedDelivery.status, 'FAILED');
    assert.equal(failedDelivery.attempt_count, 1);
    assert.equal(failedDelivery.last_error_code, safeRetryCode);
    assert(new Date(failedDelivery.next_attempt_at).getTime() > new Date(failedDelivery.last_attempt_at).getTime());
    await db.query('UPDATE notification_deliveries SET next_attempt_at=NOW() WHERE notification_id=$1', [retryNotification.id]);
    let retrySends = 0;
    const retryProvider = { send: async () => { retrySends++; return { status: 'SENT' as const, messageId: 'fake-retry' }; } };
    const concurrent = await Promise.all([
      dispatchPushDeliveries(retryProvider), dispatchPushDeliveries(retryProvider),
    ]);
    assert.equal(concurrent[0].sent + concurrent[1].sent, 1);
    assert.equal(retrySends, 1);
    assert.equal((await db.query<{ status: string; attempt_count: number }>(
      'SELECT status,attempt_count FROM notification_deliveries WHERE notification_id=$1', [retryNotification.id])).rows[0].status, 'SENT');
    assert.equal(await deliveryCount(retryNotification.id), 1);
    assert.equal((await request('DELETE', `/api/mobile/push/devices/${otherInstallationId}`, parentId)).status, 200);
    assert.equal((await db.query<{ active: boolean }>('SELECT active FROM mobile_push_devices WHERE installation_id=$1',
      [otherInstallationId])).rows[0].active, false);
    const noDeviceNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: parentId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: parentId,
        appointmentId, eventType: 'APPOINTMENT_APPROVED' });
      return notification;
    });
    assert.equal(await deliveryCount(noDeviceNotification.id), 0);
    assert.equal((await request('POST', '/api/mobile/push/devices', parentId, device(otherInstallationId, parentTarget))).status, 200);
    const oldSessionNotification = await db.transaction(async (tx) => {
      const notification = await notificationRepository.createNotification({ schoolId, userId: parentId,
        title: 'Fixture', message: 'Fixture', appointmentId }, tx);
      await enqueueAppointmentPush(tx, { notificationId: notification.id, schoolId, userId: parentId,
        appointmentId, eventType: 'APPOINTMENT_APPROVED' });
      return notification;
    });
    assert.equal(await deliveryCount(oldSessionNotification.id), 1);
    await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [parentId]);
    let revokedSessionSends = 0;
    await dispatchPushDeliveries({ send: async () => { revokedSessionSends++; return { status: 'SENT', messageId: 'should-not-send' }; } });
    assert.equal(revokedSessionSends, 0);
    assert.equal((await db.query<{ status: string }>('SELECT status FROM notification_deliveries WHERE notification_id=$1',
      [oldSessionNotification.id])).rows[0].status, 'CANCELLED');
    assert.equal((await request('POST', '/api/mobile/push/devices', parentId, device(otherInstallationId, parentTarget))).status, 401);
    assert.equal((await request('POST', '/api/mobile/push/devices', parentId, device(otherInstallationId, parentTarget), 1)).status, 200);
    assert.equal((await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM notification_deliveries
      WHERE status='PENDING' AND device_id IN (SELECT id FROM mobile_push_devices WHERE user_id=$1)`, [parentId])).rows[0].count, '0');
    let rateLimited = false;
    for (let attempt = 0; attempt < 31; attempt++) {
      const response = await request('POST', '/api/mobile/push/devices', parentId, device(otherInstallationId, parentTarget), 1);
      if (response.status === 429) { rateLimited = true; break; }
      assert.equal(response.status, 200);
    }
    assert.equal(rateLimited, true);
    console.log('Push notification tests passed.');
  } finally {
    await db.query('DELETE FROM auth_rate_limits WHERE scope_hash IN ($1,$2,$3)',
      [parentId, teacherId, securityId].map((userId) => hashSetupToken(`push-device:${userId}`))).catch(() => {});
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolId, otherSchoolId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id IN ($1,$2,$3)', [parentId, teacherId, securityId]).catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((error) => {
  console.error(error instanceof assert.AssertionError ? `Push assertion failed: ${error.message}` : 'Push notification tests failed.');
  process.exitCode = 1;
});
