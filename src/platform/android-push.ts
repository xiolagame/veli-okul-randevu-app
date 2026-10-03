import { PushNotifications, PushNotificationsPlugin } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { getRuntimePlatform, RuntimePlatform } from './runtime-platform';
import { canUseAndroidPush } from './push-eligibility';
import { parseNavigationIntent, pendingNavigationIntent } from './navigation-intent';

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

  constructor(
    private readonly native: PushNotificationsPlugin = PushNotifications,
    private readonly deviceApi: DeviceApi = defaultDeviceApi,
    private readonly runtimePlatform: () => RuntimePlatform = getRuntimePlatform,
    private readonly getInstallationId: () => string = installationId,
  ) {}

  async start(userId: string, role: string | undefined, onForeground: () => void, onStatus: (status: PushStatus) => void): Promise<void> {
    if (!canUseAndroidPush(role, this.runtimePlatform())) return;
    this.closing = false;
    if (this.userId !== userId) this.permissionGranted = false;
    this.userId = userId;
    this.onForeground = onForeground;
    this.onStatus = onStatus;
    if (this.starting) return this.starting;
    this.starting = this.attachListeners();
    try { await this.starting; } catch {
      await Promise.all(this.handles.map((handle) => handle.remove().catch(() => {})));
      this.handles = [];
      onStatus('unavailable');
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
      const registration = this.deviceApi.registerPushDevice({ installationId: this.getInstallationId(), platform: 'ANDROID', provider: 'FCM',
        targetKind: 'REGISTRATION_TOKEN', providerTarget: value, appId: 'com.velirandevu.app' })
        .then(() => { if (this.userId === owner) this.onStatus?.('ready'); })
        .catch(() => { if (this.userId === owner) this.onStatus?.('unavailable'); });
      this.registrations.add(registration);
      void registration.finally(() => this.registrations.delete(registration));
    }));
    this.handles.push(await this.native.addListener('registrationError', () => {
      this.permissionGranted = false;
      this.onStatus?.('unavailable');
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
    this.handles.push(await this.native.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const route = typeof notification.data?.route === 'string' ? notification.data.route : '';
      const intent = parseNavigationIntent(route, CANONICAL_ORIGIN);
      if (!intent) return;
      pendingNavigationIntent.set(intent);
      window.dispatchEvent(new Event('veli:navigation-intent'));
    }));
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

  async refreshPermission(): Promise<void> {
    if (!this.userId || this.closing || this.runtimePlatform() !== 'ANDROID') return;
    try {
      const permission = await this.native.checkPermissions();
      if (permission.receive !== 'granted') {
        this.permissionGranted = false;
        this.onStatus?.('off');
        await this.deviceApi.deactivatePushDevice(this.getInstallationId()).catch(() => {});
        await this.native.unregister().catch(() => {});
        return;
      }
      if (!this.permissionGranted) {
        this.permissionGranted = true;
        this.onStatus?.('preparing');
        await this.register();
      }
    } catch {
      this.permissionGranted = false;
      this.onStatus?.('unavailable');
    }
  }

  async enable(): Promise<PushStatus> {
    if (!this.userId || this.runtimePlatform() !== 'ANDROID') return 'unavailable';
    try {
      const permission = await this.native.requestPermissions();
      if (permission.receive !== 'granted') {
        await this.refreshPermission();
        return 'off';
      }
      this.permissionGranted = true;
      await this.register();
      return 'preparing';
    } catch {
      this.permissionGranted = false;
      return 'unavailable';
    }
  }

  async beforeLogout(): Promise<void> {
    if (!this.userId || this.runtimePlatform() !== 'ANDROID') return;
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
    this.userId = null;
    this.permissionGranted = false;
    this.onForeground = null;
    this.onStatus = null;
    await Promise.all(this.handles.map((handle) => handle.remove().catch(() => {})));
    this.handles = [];
  }
}

export const androidPush = new AndroidPushManager();
