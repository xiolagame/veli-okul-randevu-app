import { PushNotifications, PushNotificationsPlugin } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { getRuntimePlatform, RuntimePlatform } from './runtime-platform';
import { canUseAndroidPush } from './push-eligibility';
import { NavigationIntent, parseNavigationIntent, pendingNavigationIntent } from './navigation-intent';
import { AndroidNotificationSettings, androidNotificationSettings } from './android-notification-settings';

export type PushStatus = 'unavailable' | 'off' | 'ready' | 'preparing';

const INSTALLATION_KEY = 'veli.android.installation-id';
const CHANNEL_ID = 'veli_randevu_appointments';
const CANONICAL_ORIGIN = 'https://velirandevu.com';
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeviceRegistration = { installationId: string; platform: 'ANDROID'; provider: 'FCM'; targetKind: 'REGISTRATION_TOKEN'; providerTarget: string; appId: string };
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

export { canUseAndroidPush } from './push-eligibility';

export class AndroidPushManager {
  private userId: string | null = null;
  private handles: PluginListenerHandle[] = [];
  private starting: Promise<void> | null = null;
  private onForeground: (() => void) | null = null;
  private onStatus: ((status: PushStatus) => void) | null = null;
  private refreshQueued = false;
  private recentlyRefreshed = new Map<string, number>();
  private closing = false;
  private registrations = new Set<Promise<void>>();
  private nativeRegistration: Promise<void> | null = null;
  private permissionGranted = false;
  private backendRegistered = false;
  private status: PushStatus = 'off';
  private navigationHandle: PluginListenerHandle | null = null;
  private navigationStarting: Promise<void> | null = null;
  private sessionIdentity: (() => Promise<string | null>) | null = null;
  private sessionCleanup: Promise<void> | null = null;

  constructor(
    private readonly native: PushNotificationsPlugin = PushNotifications,
    private readonly deviceApi: DeviceApi = defaultDeviceApi,
    private readonly runtimePlatform: () => RuntimePlatform = getRuntimePlatform,
    private readonly getInstallationId: () => string = installationId,
    private readonly notificationSettings: AndroidNotificationSettings = androidNotificationSettings,
  ) {}

  async start(userId: string, role: string | undefined, onForeground: () => void, onStatus: (status: PushStatus) => void): Promise<void> {
    if (!canUseAndroidPush(role, this.runtimePlatform())) return;
    if (this.sessionCleanup) await this.sessionCleanup.catch(() => {});
    this.closing = false;
    if (this.userId !== userId) {
      this.permissionGranted = false;
      this.backendRegistered = false;
    }
    this.userId = userId;
    this.onForeground = onForeground;
    this.onStatus = onStatus;
    if (this.starting) return this.starting;
    this.starting = this.attachListeners();
    try { await this.starting; } catch {
      await Promise.all(this.handles.map((handle) => handle.remove().catch(() => {})));
      this.handles = [];
      this.emitStatus('unavailable');
      return;
    } finally { this.starting = null; }
    if (this.closing || this.userId !== userId) return;
    await this.refreshPermission();
  }

  private async attachListeners(): Promise<void> {
    if (this.handles.length) return;
    this.handles.push(await this.native.addListener('registration', ({ value }) => {
      const owner = this.userId;
      if (!owner || this.closing) return;
      this.backendRegistered = false;
      const registration = this.deviceApi.registerPushDevice({ installationId: this.getInstallationId(), platform: 'ANDROID', provider: 'FCM',
        targetKind: 'REGISTRATION_TOKEN', providerTarget: value, appId: 'com.velirandevu.app' })
        .then(() => {
          if (this.userId !== owner || this.closing) return;
          this.backendRegistered = true;
          this.emitStatus('ready');
        })
        .catch(() => {
          if (this.userId !== owner || this.closing) return;
          this.backendRegistered = false;
          this.emitStatus('unavailable');
        });
      this.registrations.add(registration);
      void registration.finally(() => this.registrations.delete(registration));
    }));
    this.handles.push(await this.native.addListener('registrationError', () => {
      this.permissionGranted = false;
      this.backendRegistered = false;
      this.emitStatus('unavailable');
    }));
    this.handles.push(await this.native.addListener('pushNotificationReceived', (notification) => {
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

  async startNavigationCapture(getSessionIdentity: () => Promise<string | null>): Promise<void> {
    if (this.runtimePlatform() !== 'ANDROID') return;
    this.sessionIdentity = getSessionIdentity;
    if (this.navigationHandle) return;
    if (!this.navigationStarting) {
      this.navigationStarting = this.native.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const route = typeof notification.data?.route === 'string' ? notification.data.route : '';
        const intent = parseNavigationIntent(route, CANONICAL_ORIGIN);
        if (!intent) return;
        void this.captureNavigationIntent(intent);
      }).then(async (handle) => {
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

  private async register(): Promise<void> {
    if (this.nativeRegistration) return this.nativeRegistration;
    this.nativeRegistration = (async () => {
      await this.native.createChannel({ id: CHANNEL_ID, name: 'Randevu bildirimleri',
        description: 'Randevu talebi ve sonuç bildirimleri', importance: 4, visibility: 1 });
      if (!this.closing) await this.native.register();
    })();
    try { await this.nativeRegistration; } finally { this.nativeRegistration = null; }
  }

  private async disablePush(status: Extract<PushStatus, 'off' | 'unavailable'>): Promise<void> {
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.emitStatus(status);
    await this.deviceApi.deactivatePushDevice(this.getInstallationId()).catch(() => {});
    await this.native.unregister().catch(() => {});
  }

  async refreshPermission(): Promise<void> {
    if (!this.userId || this.closing || this.runtimePlatform() !== 'ANDROID') return;
    try {
      const permission = await this.native.checkPermissions();
      if (permission.receive !== 'granted') {
        await this.disablePush('off');
        return;
      }
      const systemState = await this.notificationSettings.areNotificationsEnabled();
      if (!systemState.enabled) {
        await this.disablePush('off');
        return;
      }
      this.permissionGranted = true;
      if (this.backendRegistered) return;
      if (this.registrations.size) await Promise.all(this.registrations);
      if (this.backendRegistered || this.closing) return;
      this.emitStatus('preparing');
      await this.register();
    } catch {
      await this.disablePush('unavailable');
    }
  }

  async enable(): Promise<PushStatus> {
    if (!this.userId || this.runtimePlatform() !== 'ANDROID') return 'unavailable';
    try {
      const permission = await this.native.requestPermissions();
      if (permission.receive !== 'granted') {
        await this.disablePush('off');
        return 'off';
      }
      const systemState = await this.notificationSettings.areNotificationsEnabled();
      if (!systemState.enabled) {
        await this.disablePush('off');
        return 'off';
      }
      this.permissionGranted = true;
      this.emitStatus('preparing');
      await this.register();
      if (this.registrations.size) await Promise.all(this.registrations);
      return this.status;
    } catch {
      await this.disablePush('unavailable');
      return 'unavailable';
    }
  }

  async openNotificationSettings(): Promise<void> {
    if (this.runtimePlatform() !== 'ANDROID') return;
    await this.notificationSettings.openNotificationSettings();
  }

  async beforeLogout(): Promise<void> {
    if (this.sessionCleanup) return this.sessionCleanup;
    if (!this.userId || this.runtimePlatform() !== 'ANDROID') return;
    const cleanup = (async () => {
      this.closing = true;
      if (this.starting) await this.starting.catch(() => {});
      if (this.nativeRegistration) await this.nativeRegistration.catch(() => {});
      await Promise.all(this.registrations);
      let backendDeactivated = false;
      let nativeUnregistered = false;
      try { await this.deviceApi.deactivatePushDevice(this.getInstallationId()); backendDeactivated = true; } catch {}
      try { await this.native.unregister(); nativeUnregistered = true; } catch {}
      if (!backendDeactivated && !nativeUnregistered) {
        this.closing = false;
        throw new Error('Push device could not be unregistered');
      }
      await this.native.removeAllDeliveredNotifications().catch(() => {});
      await this.clearAuthenticatedRuntime();
    })();
    this.sessionCleanup = cleanup;
    try { await cleanup; } finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = null; }
  }

  async afterSessionInvalidated(): Promise<void> {
    if (this.sessionCleanup) return this.sessionCleanup;
    if (!this.userId || this.runtimePlatform() !== 'ANDROID') return;
    const cleanup = (async () => {
      this.closing = true;
      if (this.starting) await this.starting.catch(() => {});
      if (this.nativeRegistration) await this.nativeRegistration.catch(() => {});
      await Promise.all(this.registrations);
      await this.native.unregister().catch(() => {});
      await this.native.removeAllDeliveredNotifications().catch(() => {});
      await this.clearAuthenticatedRuntime();
    })();
    this.sessionCleanup = cleanup;
    try { await cleanup; } finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = null; }
  }

  private async clearAuthenticatedRuntime(): Promise<void> {
    this.userId = null;
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.status = 'off';
    this.onForeground = null;
    this.onStatus = null;
    await Promise.all(this.handles.map((handle) => handle.remove().catch(() => {})));
    this.handles = [];
  }
}

export const androidPush = new AndroidPushManager();
