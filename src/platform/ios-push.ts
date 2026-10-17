import type { PluginListenerHandle } from '@capacitor/core';
import type { PushStatus } from './android-push';
import type { RuntimePlatform } from './runtime-platform';
import { getRuntimePlatform } from './runtime-platform';
import { canUseMobilePush } from './push-eligibility';
import { NavigationIntent, parseNavigationIntent, pendingNavigationIntent } from './navigation-intent';

const INSTALLATION_KEY = 'veli.ios.installation-id';
const APP_ID = 'com.velirandevu.app';
const CANONICAL_ORIGIN = 'https://velirandevu.com';
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FCM_TOKEN_PATTERN = /^\S{20,4096}$/;

function isFcmToken(token: string): boolean {
  return FCM_TOKEN_PATTERN.test(token) && !/^[a-f0-9]{64}$/i.test(token);
}

interface IosPushNative {
  addListener(eventName: 'registration', listener: (event: { value: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'registrationError', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'pushNotificationReceived', listener: (event: { data?: Record<string, unknown> | null }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'pushNotificationActionPerformed', listener: (event: { notification: { data?: Record<string, unknown> | null } }) => void): Promise<PluginListenerHandle>;
  checkPermissions(): Promise<{ receive: 'prompt' | 'granted' | 'denied' }>;
  requestPermissions(): Promise<{ receive: 'prompt' | 'granted' | 'denied' }>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  removeAllDeliveredNotifications(): Promise<void>;
}

interface FirebaseMessagingNative {
  addListener(eventName: 'tokenReceived', listener: (event: { token: string }) => void): Promise<PluginListenerHandle>;
  getToken(): Promise<{ token: string }>;
  setAutoInit(options: { enabled: boolean }): Promise<void>;
  deleteInstance(): Promise<boolean>;
}

type DeviceRegistration = {
  installationId: string;
  platform: 'IOS';
  provider: 'FCM';
  targetKind: 'REGISTRATION_TOKEN';
  providerTarget: string;
  appId: string;
};

interface DeviceApi {
  registerPushDevice(input: DeviceRegistration): Promise<unknown>;
  deactivatePushDevice(installationId: string): Promise<unknown>;
}

const defaultDeviceApi: DeviceApi = {
  registerPushDevice: async (input) => (await import('../services/api')).api.registerPushDevice(input),
  deactivatePushDevice: async (id) => (await import('../services/api')).api.deactivatePushDevice(id),
};

function installationId(): string {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (existing && INSTALLATION_ID_PATTERN.test(existing)) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export class IosPushManager {
  private userId: string | null = null;
  private handles: PluginListenerHandle[] = [];
  private navigationHandle: PluginListenerHandle | null = null;
  private navigationStarting: Promise<void> | null = null;
  private sessionIdentity: (() => Promise<string | null>) | null = null;
  private starting: Promise<void> | null = null;
  private nativeRegistration: Promise<void> | null = null;
  private sessionCleanup: Promise<void> | null = null;
  private registrations = new Set<Promise<void>>();
  private registrationByToken = new Map<string, Promise<void>>();
  private currentFcmToken: string | null = null;
  private registeredFcmToken: string | null = null;
  private apnsRegistered = false;
  private permissionGranted = false;
  private backendRegistered = false;
  private closing = false;
  private refreshQueued = false;
  private recentlyRefreshed = new Map<string, number>();
  private onForeground: (() => void) | null = null;
  private onStatus: ((status: PushStatus) => void) | null = null;
  private status: PushStatus = 'off';
  private nativePromise: Promise<IosPushNative> | null = null;
  private fcmPromise: Promise<FirebaseMessagingNative> | null = null;

  constructor(
    private readonly deviceApi: DeviceApi = defaultDeviceApi,
    private readonly runtimePlatform: () => RuntimePlatform = getRuntimePlatform,
    private readonly getInstallationId: () => string = installationId,
    private readonly nativeOverride?: IosPushNative,
    private readonly fcmOverride?: FirebaseMessagingNative,
    private readonly openSettingsOverride?: () => Promise<void>,
  ) {}

  async start(userId: string, role: string | undefined, onForeground: () => void, onStatus: (status: PushStatus) => void): Promise<void> {
    if (this.runtimePlatform() !== 'IOS' || !canUseMobilePush(role, 'IOS')) return;
    if (this.sessionCleanup) await this.sessionCleanup.catch(() => {});
    this.closing = false;
    if (this.userId !== userId) {
      this.currentFcmToken = null;
      this.registeredFcmToken = null;
      this.permissionGranted = false;
      this.backendRegistered = false;
      this.apnsRegistered = false;
    }
    this.userId = userId;
    this.onForeground = onForeground;
    this.onStatus = onStatus;
    if (this.starting) return this.starting;
    this.starting = this.attachListeners();
    try {
      await this.starting;
    } catch {
      await this.removePushListeners();
      this.emitStatus('unavailable');
      this.starting = null;
      return;
    }
    this.starting = null;
    if (this.closing || this.userId !== userId) return;
    await this.refreshPermission();
  }

  private async native(): Promise<IosPushNative> {
    if (this.nativeOverride) return this.nativeOverride;
    if (!this.nativePromise) this.nativePromise = import('@capacitor/push-notifications').then(({ PushNotifications }) => PushNotifications as unknown as IosPushNative);
    return this.nativePromise;
  }

  private async firebaseMessaging(): Promise<FirebaseMessagingNative> {
    if (this.fcmOverride) return this.fcmOverride;
    if (!this.fcmPromise) this.fcmPromise = import('@capacitor-community/fcm').then(({ FCM }) => FCM);
    return this.fcmPromise;
  }

  private async attachListeners(): Promise<void> {
    if (this.handles.length) return;
    const native = await this.native();
    const fcm = await this.firebaseMessaging();
    this.handles.push(await fcm.addListener('tokenReceived', ({ token }) => {
      if (!this.permissionGranted || this.closing || !isFcmToken(token)) return;
      this.acceptFcmToken(token, this.userId);
    }));
    this.handles.push(await native.addListener('registration', () => {
      if (!this.userId || this.closing || !this.permissionGranted) return;
      this.apnsRegistered = true;
      void this.resolveFcmRegistrationToken();
    }));
    this.handles.push(await native.addListener('registrationError', () => {
      this.apnsRegistered = false;
      this.backendRegistered = false;
      this.emitStatus('unavailable');
    }));
    this.handles.push(await native.addListener('pushNotificationReceived', (notification) => {
      const notificationId = typeof notification.data?.notificationId === 'string' ? notification.data.notificationId : '';
      if (notificationId) {
        const lastRefresh = this.recentlyRefreshed.get(notificationId) || 0;
        if (Date.now() - lastRefresh < 2000) return;
        this.recentlyRefreshed.set(notificationId, Date.now());
        if (this.recentlyRefreshed.size > 100) this.recentlyRefreshed.delete(this.recentlyRefreshed.keys().next().value!);
      }
      if (this.refreshQueued) return;
      this.refreshQueued = true;
      queueMicrotask(() => { this.refreshQueued = false; this.onForeground?.(); });
    }));
  }

  private async resolveFcmRegistrationToken(): Promise<void> {
    const owner = this.userId;
    if (!owner || this.closing || !this.permissionGranted) return;
    try {
      const { token } = await (await this.firebaseMessaging()).getToken();
      if (this.userId !== owner || this.closing || !this.permissionGranted || !isFcmToken(token)) return;
      this.acceptFcmToken(token, owner);
    } catch {
      if (this.userId === owner && !this.closing) this.emitStatus('unavailable');
    }
  }

  private trackRegistration(registration: Promise<void>): void {
    this.registrations.add(registration);
    void registration.finally(() => this.registrations.delete(registration));
  }

  private acceptFcmToken(token: string, owner: string | null): void {
    if (!owner || this.userId !== owner || this.closing || !this.permissionGranted) return;
    if (token === this.registeredFcmToken) return;
    if (token === this.currentFcmToken && (this.backendRegistered || this.registrationByToken.has(`${owner}:${token}`))) return;
    this.currentFcmToken = token;
    this.backendRegistered = false;
    void this.registerToken(token, owner);
  }

  private registerToken(token: string, owner: string | null): Promise<void> {
    if (!owner || this.userId !== owner || this.closing || !this.permissionGranted) return Promise.resolve();
    if (token === this.registeredFcmToken) return Promise.resolve();
    const key = `${owner}:${token}`;
    const existing = this.registrationByToken.get(key);
    if (existing) return existing;
    const registration = this.performTokenRegistration(token, owner);
    this.registrationByToken.set(key, registration);
    this.trackRegistration(registration);
    void registration.finally(() => {
      if (this.registrationByToken.get(key) === registration) this.registrationByToken.delete(key);
    });
    return registration;
  }

  private async performTokenRegistration(token: string, owner: string): Promise<void> {
    this.emitStatus('preparing');
    try {
      await this.deviceApi.registerPushDevice({ installationId: this.getInstallationId(), platform: 'IOS', provider: 'FCM',
        targetKind: 'REGISTRATION_TOKEN', providerTarget: token, appId: APP_ID });
      if (this.userId !== owner || this.closing || !this.permissionGranted) return;
      this.registeredFcmToken = token;
      this.backendRegistered = true;
      this.emitStatus('ready');
    } catch {
      if (this.userId !== owner || this.closing) return;
      this.backendRegistered = false;
      this.emitStatus('unavailable');
    }
  }

  async startNavigationCapture(getSessionIdentity: () => Promise<string | null>): Promise<void> {
    if (this.runtimePlatform() !== 'IOS') return;
    this.sessionIdentity = getSessionIdentity;
    if (this.navigationHandle) return;
    if (!this.navigationStarting) {
      this.navigationStarting = this.native().then((native) => native.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const route = typeof notification.data?.route === 'string' ? notification.data.route : '';
        const intent = parseNavigationIntent(route, CANONICAL_ORIGIN);
        if (intent) void this.captureNavigationIntent(intent);
      })).then(async (handle) => {
        if (!this.sessionIdentity) await handle.remove().catch(() => {});
        else this.navigationHandle = handle;
      }).finally(() => { this.navigationStarting = null; });
    }
    await this.navigationStarting;
  }

  async stopNavigationCapture(): Promise<void> {
    this.sessionIdentity = null;
    if (this.navigationStarting) await this.navigationStarting.catch(() => {});
    const handle = this.navigationHandle;
    this.navigationHandle = null;
    if (handle) await handle.remove().catch(() => {});
  }

  private async captureNavigationIntent(intent: NavigationIntent): Promise<void> {
    const getSessionIdentity = this.sessionIdentity;
    if (!getSessionIdentity) return;
    const identity = await getSessionIdentity().catch(() => null);
    if (!identity || await getSessionIdentity().catch(() => null) !== identity) return;
    pendingNavigationIntent.set(intent);
    window.dispatchEvent(new Event('veli:navigation-intent'));
  }

  private emitStatus(status: PushStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }

  private async nativeRegister(): Promise<void> {
    if (this.nativeRegistration) return this.nativeRegistration;
    const registration = (async () => {
      if (!this.closing) await (await this.native()).register();
    })();
    this.nativeRegistration = registration;
    try { await registration; } finally { if (this.nativeRegistration === registration) this.nativeRegistration = null; }
  }

  private async disablePush(status: 'off' | 'denied' | 'unavailable'): Promise<void> {
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.currentFcmToken = null;
    this.registeredFcmToken = null;
    this.apnsRegistered = false;
    this.emitStatus(status);
    await Promise.all(this.registrations);
    await this.deviceApi.deactivatePushDevice(this.getInstallationId()).catch(() => {});
    await (await this.firebaseMessaging()).setAutoInit({ enabled: false }).catch(() => {});
    await (await this.native()).unregister().catch(() => {});
  }

  async refreshPermission(): Promise<void> {
    if (!this.userId || this.closing || this.runtimePlatform() !== 'IOS') return;
    try {
      const permission = await (await this.native()).checkPermissions();
      if (permission.receive === 'denied') {
        await this.disablePush('denied');
        return;
      }
      if (permission.receive !== 'granted') {
        this.permissionGranted = false;
        this.emitStatus('off');
        await (await this.firebaseMessaging()).setAutoInit({ enabled: false }).catch(() => {});
        return;
      }
      this.permissionGranted = true;
      await (await this.firebaseMessaging()).setAutoInit({ enabled: true });
      if (this.currentFcmToken) {
        if (!this.backendRegistered) await this.registerToken(this.currentFcmToken, this.userId);
        return;
      }
      if (this.apnsRegistered) {
        await this.resolveFcmRegistrationToken();
        await Promise.all(this.registrations);
        return;
      }
      this.emitStatus('preparing');
      await this.nativeRegister();
    } catch {
      await this.disablePush('unavailable');
    }
  }

  async enable(): Promise<PushStatus> {
    if (!this.userId || this.runtimePlatform() !== 'IOS') return 'unavailable';
    try {
      const native = await this.native();
      const permission = await native.checkPermissions();
      if (permission.receive === 'denied') {
        await this.disablePush('denied');
        return this.status;
      }
      const requested = permission.receive === 'granted' ? permission : await native.requestPermissions();
      if (requested.receive !== 'granted') {
        await this.disablePush(requested.receive === 'denied' ? 'denied' : 'off');
        return this.status;
      }
      this.permissionGranted = true;
      this.emitStatus('preparing');
      await (await this.firebaseMessaging()).setAutoInit({ enabled: true });
      await this.nativeRegister();
      if (this.currentFcmToken) await this.registerToken(this.currentFcmToken, this.userId);
      await Promise.all(this.registrations);
      return this.status;
    } catch {
      await this.disablePush('unavailable');
      return this.status;
    }
  }

  async openNotificationSettings(): Promise<void> {
    if (this.runtimePlatform() !== 'IOS') return;
    if (this.openSettingsOverride) return this.openSettingsOverride();
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const result = await AppLauncher.openUrl({ url: 'app-settings:' });
    if (!result.completed) throw new Error('Could not open application settings');
  }

  async beforeLogout(): Promise<void> {
    if (this.sessionCleanup) return this.sessionCleanup;
    if (!this.userId || this.runtimePlatform() !== 'IOS') return;
    const cleanup = (async () => {
      this.closing = true;
      if (this.starting) await this.starting.catch(() => {});
      if (this.nativeRegistration) await this.nativeRegistration.catch(() => {});
      await Promise.all(this.registrations);
      let backendDeactivated = false;
      let nativeCleared = false;
      try { await this.deviceApi.deactivatePushDevice(this.getInstallationId()); backendDeactivated = true; } catch {}
      try { await (await this.native()).unregister(); nativeCleared = true; } catch {}
      try { await (await this.firebaseMessaging()).deleteInstance(); nativeCleared = true; } catch {}
      if (!backendDeactivated && !nativeCleared) {
        this.closing = false;
        throw new Error('Push device could not be unregistered');
      }
      await (await this.native()).removeAllDeliveredNotifications().catch(() => {});
      await this.clearAuthenticatedRuntime();
    })();
    this.sessionCleanup = cleanup;
    try { await cleanup; } finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = null; }
  }

  async afterSessionInvalidated(): Promise<void> {
    if (this.sessionCleanup) return this.sessionCleanup;
    if (!this.userId || this.runtimePlatform() !== 'IOS') return;
    const cleanup = (async () => {
      this.closing = true;
      if (this.starting) await this.starting.catch(() => {});
      if (this.nativeRegistration) await this.nativeRegistration.catch(() => {});
      await Promise.all(this.registrations);
      await (await this.native()).unregister().catch(() => {});
      await (await this.firebaseMessaging()).deleteInstance().catch(() => {});
      await (await this.native()).removeAllDeliveredNotifications().catch(() => {});
      await this.clearAuthenticatedRuntime();
    })();
    this.sessionCleanup = cleanup;
    try { await cleanup; } finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = null; }
  }

  private async removePushListeners(): Promise<void> {
    await Promise.all(this.handles.map((handle) => handle.remove().catch(() => {})));
    this.handles = [];
  }

  private async clearAuthenticatedRuntime(): Promise<void> {
    this.userId = null;
    this.currentFcmToken = null;
    this.registeredFcmToken = null;
    this.apnsRegistered = false;
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.registrationByToken.clear();
    this.status = 'off';
    this.onForeground = null;
    this.onStatus = null;
    await this.removePushListeners();
  }
}

export const iosPush = new IosPushManager();
