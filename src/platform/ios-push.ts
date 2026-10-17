import type { PluginListenerHandle } from '@capacitor/core';
import type { PushStatus } from './android-push';
import type { RuntimePlatform } from './runtime-platform';
import { getRuntimePlatform } from './runtime-platform';
import { canUseMobilePush } from './push-eligibility';
import { NavigationIntent, parseNavigationIntent, pendingNavigationIntent } from './navigation-intent';

const INSTALLATION_KEY = 'veli.ios.installation-id';
const REGISTRATION_GENERATION_KEY = 'veli.ios.registration-generation';
const CLEANUP_PENDING_KEY = 'veli.ios.push-cleanup-pending';
const APP_ID = 'com.velirandevu.app';
const CANONICAL_ORIGIN = 'https://velirandevu.com';
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FCM_TOKEN_PATTERN = /^\S{20,4096}$/;

type ActivationStage = 'permission-check' | 'permission-request' | 'fcm-init' | 'apns-register' | 'apns-callback' | 'fcm-token' | 'device-registration' | 'cleanup';

export class IosPushActivationError extends Error {
  constructor(readonly stage: ActivationStage) {
    super(`iOS push activation did not complete at ${stage}`);
    this.name = 'IosPushActivationError';
  }

  get userMessage(): string {
    if (this.stage === 'permission-check') return 'Bildirim izni durumu okunamadı. Biraz sonra yeniden deneyin.';
    if (this.stage === 'permission-request') return 'iOS bildirim izni isteği tamamlanmadı. İzin penceresi açıksa yanıtlayın; ardından yeniden deneyin.';
    if (this.stage === 'apns-register') return 'iPhone bildirim kaydı tamamlanmadı. Uygulamayı tamamen kapatıp yeniden açın.';
    if (this.stage === 'apns-callback') return 'iPhone bildirim kaydından yanıt alınamadı. Uygulamayı tamamen kapatıp yeniden açın.';
    if (this.stage === 'fcm-init') return 'Bildirim hizmeti başlatılamadı. Biraz sonra yeniden deneyin.';
    if (this.stage === 'fcm-token') return 'Bildirim hizmetinden cihaz yanıtı alınamadı. Uygulamayı tamamen kapatıp yeniden açın.';
    if (this.stage === 'device-registration') return 'Cihaz kaydı tamamlanamadı. Bağlantınızı kontrol edip yeniden deneyin.';
    return 'Bildirim ayarları tamamlanamadı. Uygulamayı yeniden açıp tekrar deneyin.';
  }
}

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
  // iOS resolves an empty plugin call on success; the declared boolean is not returned there.
  deleteInstance(): Promise<unknown>;
}

type DeviceRegistration = {
  installationId: string;
  registrationGeneration: number;
  platform: 'IOS';
  provider: 'FCM';
  targetKind: 'REGISTRATION_TOKEN';
  providerTarget: string;
  appId: string;
};

interface DeviceApi {
  registerPushDevice(input: DeviceRegistration): Promise<unknown>;
  deactivatePushDevice(installationId: string, registrationGeneration: number): Promise<unknown>;
}

const defaultDeviceApi: DeviceApi = {
  registerPushDevice: async (input) => (await import('../services/api')).api.registerPushDevice(input),
  deactivatePushDevice: async (id, generation) => (await import('../services/api')).api.deactivatePushDevice(id, generation),
};

function installationId(): string {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (existing && INSTALLATION_ID_PATTERN.test(existing)) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

function readStoredRegistrationGeneration(): number {
  const stored = localStorage.getItem(REGISTRATION_GENERATION_KEY);
  if (stored !== null) {
    const value = Number(stored);
    if (Number.isSafeInteger(value) && value > 0 && String(value) === stored) return value;
    throw new Error('Invalid iOS push registration generation');
  }
  localStorage.setItem(REGISTRATION_GENERATION_KEY, '1');
  return 1;
}

function advanceStoredRegistrationGeneration(): void {
  const next = readStoredRegistrationGeneration() + 1;
  if (!Number.isSafeInteger(next)) throw new Error('iOS push registration generation exhausted');
  localStorage.setItem(REGISTRATION_GENERATION_KEY, String(next));
}

function cleanupPending(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(CLEANUP_PENDING_KEY) === '1'; }
  catch { return true; }
}

function setCleanupPending(pending: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (pending) localStorage.setItem(CLEANUP_PENDING_KEY, '1');
    else localStorage.removeItem(CLEANUP_PENDING_KEY);
  } catch { /* Push cleanup must never prevent local session removal. */ }
}

export class IosPushManager {
  private userId: string | null = null;
  private handles: PluginListenerHandle[] = [];
  private navigationHandle: PluginListenerHandle | null = null;
  private navigationStarting: Promise<void> | null = null;
  private sessionIdentity: (() => Promise<string | null>) | null = null;
  private starting: Promise<void> | null = null;
  private nativeRegistration: Promise<void> | null = null;
  private permissionRequest: Promise<{ receive: 'prompt' | 'granted' | 'denied' }> | null = null;
  private sessionCleanup: Promise<void> | null = null;
  private cleanupRecovery: Promise<boolean> | null = null;
  private registrations = new Set<Promise<void>>();
  private lastRegistration: Promise<void> = Promise.resolve();
  private registrationByToken = new Map<string, { generation: number; promise: Promise<void> }>();
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
  private activationStage: ActivationStage = 'permission-check';
  private activationGeneration = 0;
  private nativeRetryBlocked = false;
  private cleanupRecoveryBlocked = false;
  private cleanupRecoveredForSession = false;
  private listenerEpoch = 0;
  private backendRetryInProgress = false;
  private enableInProgress = false;
  private lastFailureStage: ActivationStage | null = null;
  private readonly statusListeners = new Set<(status: PushStatus) => void>();
  private nativePromise: Promise<IosPushNative> | null = null;
  private fcmPromise: Promise<FirebaseMessagingNative> | null = null;

  constructor(
    private readonly deviceApi: DeviceApi = defaultDeviceApi,
    private readonly runtimePlatform: () => RuntimePlatform = getRuntimePlatform,
    private readonly getInstallationId: () => string = installationId,
    private readonly nativeOverride?: IosPushNative,
    private readonly fcmOverride?: FirebaseMessagingNative,
    private readonly openSettingsOverride?: () => Promise<void>,
    private readonly activationTimeoutOverrideMs?: number,
    private readonly getRegistrationGeneration: () => number = readStoredRegistrationGeneration,
    private readonly advanceRegistrationGeneration: () => void = advanceStoredRegistrationGeneration,
  ) {}

  async start(userId: string, role: string | undefined, onForeground: () => void, onStatus: (status: PushStatus) => void): Promise<void> {
    if (this.runtimePlatform() !== 'IOS' || !canUseMobilePush(role, 'IOS')) return;
    if (this.sessionCleanup) await this.sessionCleanup.catch(() => {});
    if (this.userId && this.userId !== userId) await this.afterSessionInvalidated();
    this.closing = false;
    if (this.userId !== userId) {
      this.activationGeneration++;
      this.currentFcmToken = null;
      this.registeredFcmToken = null;
      this.permissionGranted = false;
      this.backendRegistered = false;
      this.apnsRegistered = false;
    }
    this.userId = userId;
    this.onForeground = onForeground;
    this.onStatus = onStatus;
    if (!await this.recoverPendingCleanup()) { this.emitStatus('unavailable'); return; }
    if (this.starting) return this.starting;
    const sessionEpoch = this.listenerEpoch;
    const starting = this.attachListeners();
    this.starting = starting;
    try {
      await starting;
    } catch {
      if (this.starting !== starting) return;
      await this.removePushListeners();
      this.emitStatus('unavailable');
      if (this.starting === starting) this.starting = null;
      return;
    }
    if (this.starting === starting) this.starting = null;
    if (this.closing || this.userId !== userId || this.listenerEpoch !== sessionEpoch) return;
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
    const epoch = this.listenerEpoch;
    const keepHandle = async (handle: PluginListenerHandle): Promise<boolean> => {
      if (epoch !== this.listenerEpoch) { await handle.remove().catch(() => {}); return false; }
      this.handles.push(handle);
      return true;
    };
    const native = await this.native();
    const fcm = await this.firebaseMessaging();
    if (!await keepHandle(await fcm.addListener('tokenReceived', ({ token }) => {
      if (epoch !== this.listenerEpoch) return;
      if (!this.permissionGranted || this.closing || this.nativeRetryBlocked || this.backendRetryInProgress || !isFcmToken(token)) return;
      this.acceptFcmToken(token, this.userId, this.activationGeneration);
    }))) return;
    if (!await keepHandle(await native.addListener('registration', () => {
      if (epoch !== this.listenerEpoch) return;
      if (!this.userId || this.closing || !this.permissionGranted || this.nativeRetryBlocked || this.backendRetryInProgress) return;
      this.apnsRegistered = true;
      this.activationStage = 'fcm-token';
      void this.resolveFcmRegistrationToken(this.activationGeneration);
    }))) return;
    if (!await keepHandle(await native.addListener('registrationError', () => {
      if (epoch !== this.listenerEpoch) return;
      if (this.closing || this.nativeRetryBlocked || this.backendRetryInProgress) return;
      this.apnsRegistered = false;
      this.backendRegistered = false;
      this.activationStage = 'apns-callback';
      this.emitStatus('unavailable');
    }))) return;
    await keepHandle(await native.addListener('pushNotificationReceived', (notification) => {
      if (epoch !== this.listenerEpoch) return;
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

  private async resolveFcmRegistrationToken(generation = this.activationGeneration): Promise<void> {
    const owner = this.userId;
    if (!owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration) return;
    try {
      this.activationStage = 'fcm-token';
      const fcm = await this.awaitActivationStage('fcm-token', this.firebaseMessaging());
      const { token } = await this.awaitActivationStage('fcm-token', fcm.getToken());
      if (this.userId !== owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration || !isFcmToken(token)) return;
      if (token === this.currentFcmToken) return;
      this.acceptFcmToken(token, owner, generation);
    } catch {
      if (this.userId === owner && !this.closing && generation === this.activationGeneration && !this.backendRegistered) this.emitStatus('unavailable');
    }
  }

  private trackRegistration(registration: Promise<void>): void {
    this.registrations.add(registration);
    void registration.finally(() => this.registrations.delete(registration));
  }

  private acceptFcmToken(token: string, owner: string | null, generation: number): void {
    if (!owner || this.userId !== owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration) return;
    if (token === this.registeredFcmToken) return;
    if (token === this.currentFcmToken && (this.backendRegistered || this.registrationByToken.get(`${owner}:${token}`)?.generation === generation)) return;
    this.currentFcmToken = token;
    this.backendRegistered = false;
    void this.registerToken(token, owner, generation);
  }

  private registerToken(token: string, owner: string | null, generation = this.activationGeneration): Promise<void> {
    if (!owner || this.userId !== owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration) return Promise.resolve();
    if (token === this.registeredFcmToken) return Promise.resolve();
    const key = `${owner}:${token}`;
    const existing = this.registrationByToken.get(key);
    if (existing?.generation === generation) return existing.promise;
    const previous = this.lastRegistration;
    const registration = (async () => {
      await previous;
      if (this.userId !== owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration || token === this.registeredFcmToken) return;
      await this.performTokenRegistration(token, owner, generation);
    })();
    this.lastRegistration = registration;
    this.registrationByToken.set(key, { generation, promise: registration });
    this.trackRegistration(registration);
    return registration;
  }

  private async performTokenRegistration(token: string, owner: string, generation: number): Promise<void> {
    this.activationStage = 'device-registration';
    this.emitStatus('preparing');
    try {
      await this.deviceApi.registerPushDevice({ installationId: this.getInstallationId(), registrationGeneration: this.getRegistrationGeneration(), platform: 'IOS', provider: 'FCM',
        targetKind: 'REGISTRATION_TOKEN', providerTarget: token, appId: APP_ID });
      if (this.userId !== owner || this.closing || !this.permissionGranted || generation !== this.activationGeneration || token !== this.currentFcmToken) return;
      setCleanupPending(false);
      this.registeredFcmToken = token;
      this.backendRegistered = true;
      this.emitStatus('ready');
    } catch {
      if (this.userId !== owner || this.closing || generation !== this.activationGeneration) return;
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
    for (const listener of this.statusListeners) listener(status);
  }

  private stageTimeoutMs(stage: ActivationStage): number {
    if (this.activationTimeoutOverrideMs !== undefined) return this.activationTimeoutOverrideMs;
    if (stage === 'cleanup') return 8_000;
    return stage === 'permission-request' ? 60_000 : stage === 'device-registration' ? 30_000 : 20_000;
  }

  private async awaitActivationStage<T>(stage: ActivationStage, work: Promise<T>): Promise<T> {
    this.activationStage = stage;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new IosPushActivationError(stage)), this.stageTimeoutMs(stage));
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async awaitActivationResult(): Promise<void> {
    if (this.status === 'ready') return;
    if (this.status !== 'preparing') throw new IosPushActivationError(this.activationStage);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new IosPushActivationError(this.activationStage)), this.stageTimeoutMs('device-registration'));
      const listener = (status: PushStatus) => {
        if (status === 'ready') finish();
        else if (status !== 'preparing') finish(new IosPushActivationError(this.activationStage));
      };
      const finish = (error?: IosPushActivationError) => {
        clearTimeout(timer);
        this.statusListeners.delete(listener);
        if (error) reject(error);
        else resolve();
      };
      this.statusListeners.add(listener);
    });
  }

  private async nativeRegister(): Promise<void> {
    if (this.nativeRegistration) return this.nativeRegistration;
    const registration = (async () => {
      if (!this.closing) await (await this.native()).register();
    })();
    this.nativeRegistration = registration;
    try { await registration; } finally { if (this.nativeRegistration === registration) this.nativeRegistration = null; }
  }

  private requestNativePermission(native: IosPushNative): Promise<{ receive: 'prompt' | 'granted' | 'denied' }> {
    if (this.permissionRequest) return this.permissionRequest;
    const request = native.requestPermissions();
    this.permissionRequest = request;
    void request.finally(() => { if (this.permissionRequest === request) this.permissionRequest = null; }).catch(() => {});
    return request;
  }

  private async disablePush(status: 'off' | 'denied' | 'unavailable'): Promise<void> {
    let revokedGeneration: number | null = null;
    try { revokedGeneration = this.getRegistrationGeneration(); this.advanceRegistrationGeneration(); } catch { /* Fail closed if local generation storage is unavailable. */ }
    this.activationGeneration++;
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.currentFcmToken = null;
    this.registeredFcmToken = null;
    this.apnsRegistered = false;
    this.emitStatus('preparing');
    try {
      await this.awaitActivationStage('cleanup', Promise.all(this.registrations));
      const results = await Promise.allSettled([
        revokedGeneration === null ? Promise.reject(new Error('Push generation unavailable'))
          : this.awaitActivationStage('cleanup', this.deviceApi.deactivatePushDevice(this.getInstallationId(), revokedGeneration)),
        this.awaitActivationStage('cleanup', this.firebaseMessaging().then((fcm) => fcm.setAutoInit({ enabled: false }))),
        this.awaitActivationStage('cleanup', this.native().then((native) => native.unregister())),
      ]);
      this.emitStatus(results[0].status === 'fulfilled' ? status : 'unavailable');
    } catch {
      this.emitStatus('unavailable');
    }
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
        await this.awaitActivationStage('cleanup', this.firebaseMessaging().then((fcm) => fcm.setAutoInit({ enabled: false }))).catch(() => {});
        return;
      }
      if (this.nativeRetryBlocked || (this.lastFailureStage && this.lastFailureStage !== 'device-registration')) { this.emitStatus('unavailable'); return; }
      if (this.enableInProgress) return;
      if (this.backendRegistered) return;
      void this.enable().catch(() => {});
    } catch {
      await this.disablePush('unavailable');
    }
  }

  async enable(): Promise<PushStatus> {
    if (!this.userId || this.runtimePlatform() !== 'IOS') return 'unavailable';
    if (!await this.recoverPendingCleanup()) throw new IosPushActivationError('cleanup');
    if (!this.handles.length) await this.awaitActivationStage('cleanup', this.attachListeners());
    if (this.enableInProgress) throw new IosPushActivationError(this.activationStage);
    if (this.nativeRetryBlocked) throw new IosPushActivationError(this.lastFailureStage ?? 'apns-callback');
    if (this.permissionRequest) throw new IosPushActivationError('permission-request');
    const generation = ++this.activationGeneration;
    const retryBackend = this.lastFailureStage === 'device-registration' && !!this.currentFcmToken && this.apnsRegistered;
    this.backendRetryInProgress = retryBackend;
    this.enableInProgress = true;
    this.emitStatus('preparing');
    try {
      const native = await this.awaitActivationStage('permission-check', this.native());
      const permission = await this.awaitActivationStage('permission-check', native.checkPermissions());
      if (permission.receive === 'denied') {
        await this.awaitActivationStage('cleanup', this.disablePush('denied'));
        return this.status;
      }
      const requested = permission.receive === 'granted' ? permission : await this.awaitActivationStage('permission-request', this.requestNativePermission(native));
      if (requested.receive !== 'granted') {
        await this.awaitActivationStage('cleanup', this.disablePush(requested.receive === 'denied' ? 'denied' : 'off'));
        return this.status;
      }
      this.permissionGranted = true;
      this.emitStatus('preparing');
      const fcm = await this.awaitActivationStage('fcm-init', this.firebaseMessaging());
      await this.awaitActivationStage('fcm-init', fcm.setAutoInit({ enabled: true }));
      if (!retryBackend && !this.apnsRegistered) await this.awaitActivationStage('apns-register', this.nativeRegister());
      if (this.currentFcmToken) await this.awaitActivationStage('device-registration', this.registerToken(this.currentFcmToken, this.userId, generation));
      else this.activationStage = this.apnsRegistered ? 'fcm-token' : 'apns-callback';
      await this.awaitActivationResult();
      this.backendRetryInProgress = false;
      this.lastFailureStage = null;
      return this.status;
    } catch (error) {
      if (this.closing || generation !== this.activationGeneration || (this.status === 'denied' && this.activationStage !== 'permission-check' && this.activationStage !== 'permission-request')) return this.status;
      const stage = error instanceof IosPushActivationError ? error.stage : this.activationStage;
      this.activationGeneration++;
      this.lastFailureStage = stage;
      this.nativeRetryBlocked = stage === 'apns-register' || stage === 'apns-callback' || stage === 'fcm-token';
      this.backendRetryInProgress = false;
      this.permissionGranted = false;
      this.emitStatus('unavailable');
      throw error instanceof IosPushActivationError ? error : new IosPushActivationError(stage);
    } finally {
      this.enableInProgress = false;
    }
  }

  async openNotificationSettings(): Promise<void> {
    if (this.runtimePlatform() !== 'IOS') return;
    if (this.openSettingsOverride) return this.openSettingsOverride();
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const result = await AppLauncher.openUrl({ url: 'app-settings:' });
    if (!result.completed) throw new Error('Could not open application settings');
  }

  private async recoverPendingCleanup(): Promise<boolean> {
    if (this.cleanupRecovery) return this.cleanupRecovery;
    const recovery = this.performPendingCleanupRecovery();
    this.cleanupRecovery = recovery;
    try { return await recovery; }
    finally { if (this.cleanupRecovery === recovery) this.cleanupRecovery = null; }
  }

  private async performPendingCleanupRecovery(): Promise<boolean> {
    if (!cleanupPending() && !this.cleanupRecoveryBlocked) return true;
    if (this.nativeRegistration) {
      try { await this.awaitActivationStage('cleanup', this.nativeRegistration); }
      catch { this.cleanupRecoveryBlocked = true; return false; }
    }
    if (this.registrations.size) {
      try { await this.awaitActivationStage('cleanup', Promise.all(this.registrations)); } catch { this.cleanupRecoveryBlocked = true; return false; }
    }
    if (this.cleanupRecoveredForSession) return true;
    const [unregistered, deleted] = await Promise.allSettled([
      this.awaitActivationStage('cleanup', this.native().then((native) => native.unregister())),
      this.awaitActivationStage('cleanup', this.firebaseMessaging().then((fcm) => fcm.deleteInstance())),
    ]);
    this.cleanupRecoveryBlocked = unregistered.status !== 'fulfilled' || deleted.status !== 'fulfilled';
    if (!this.cleanupRecoveryBlocked) {
      this.nativeRetryBlocked = false;
      this.lastFailureStage = null;
      this.cleanupRecoveredForSession = true;
    }
    return !this.cleanupRecoveryBlocked;
  }

  private async finishSession(deactivateBackend: boolean): Promise<void> {
    if (this.sessionCleanup) return this.sessionCleanup;
    if (!this.userId || this.runtimePlatform() !== 'IOS') return;
    const cleanup = (async () => {
      this.closing = true;
      this.activationGeneration++;
      this.backendRetryInProgress = false;
      let revokedGeneration: number | null = null;
      try { revokedGeneration = this.getRegistrationGeneration(); this.advanceRegistrationGeneration(); } catch { /* Local logout continues. */ }
      setCleanupPending(true);
      try {
        this.emitStatus('unavailable');
        // The server's generation tombstone makes DELETE safe even when an older POST is still in flight.
        // Start it immediately instead of adding each native/registration timeout to logout latency.
        const starting = this.starting ? this.awaitActivationStage('cleanup', this.starting.catch(() => {})) : Promise.resolve();
        const nativeRegistration = this.nativeRegistration ? this.awaitActivationStage('cleanup', this.nativeRegistration) : Promise.resolve();
        const registrations = this.awaitActivationStage('cleanup', Promise.all(this.registrations));
        const backend = deactivateBackend && revokedGeneration !== null
          ? this.awaitActivationStage('cleanup', Promise.resolve().then(() => this.deviceApi.deactivatePushDevice(this.getInstallationId(), revokedGeneration)))
          : Promise.resolve();
        const unregistered = nativeRegistration.catch(() => {}).then(() =>
          this.awaitActivationStage('cleanup', this.native().then((native) => native.unregister())));
        const deleted = this.awaitActivationStage('cleanup', this.firebaseMessaging().then((fcm) => fcm.deleteInstance()));
        const delivered = this.awaitActivationStage('cleanup', this.native().then((native) => native.removeAllDeliveredNotifications()));
        const [startingResult, nativeRegistrationResult, registrationsResult, backendResult, unregisteredResult, deletedResult] = await Promise.allSettled([
          starting, nativeRegistration, registrations, backend, unregistered, deleted, delivered,
          this.awaitActivationStage('cleanup', this.clearAuthenticatedRuntime()),
        ]);
        if (startingResult.status === 'fulfilled' && registrationsResult.status === 'fulfilled' && nativeRegistrationResult.status === 'fulfilled'
          && deactivateBackend && revokedGeneration !== null && backendResult.status === 'fulfilled'
          && unregisteredResult.status === 'fulfilled' && deletedResult.status === 'fulfilled') {
          setCleanupPending(false);
          this.nativeRetryBlocked = false;
          this.cleanupRecoveryBlocked = false;
          this.lastFailureStage = null;
        }
      } catch { /* No push failure may retain the authenticated session. */ }
      finally { if (this.userId) await this.awaitActivationStage('cleanup', this.clearAuthenticatedRuntime()).catch(() => {}); }
    })();
    this.sessionCleanup = cleanup;
    try { await cleanup; } finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = null; }
  }

  async beforeLogout(): Promise<void> { await this.finishSession(true); }

  async afterSessionInvalidated(): Promise<void> {
    await this.finishSession(false);
  }

  private async removePushListeners(): Promise<void> {
    const handles = this.handles;
    this.handles = [];
    await Promise.all(handles.map((handle) => handle.remove().catch(() => {})));
  }

  private async clearAuthenticatedRuntime(): Promise<void> {
    this.activationGeneration++;
    this.listenerEpoch++;
    this.starting = null;
    this.cleanupRecoveredForSession = false;
    this.userId = null;
    this.currentFcmToken = null;
    this.registeredFcmToken = null;
    this.apnsRegistered = false;
    this.permissionGranted = false;
    this.backendRegistered = false;
    this.registrationByToken.clear();
    this.lastFailureStage = this.nativeRetryBlocked ? 'apns-register' : null;
    this.status = 'off';
    this.onForeground = null;
    this.onStatus = null;
    await this.removePushListeners();
  }
}

export const iosPush = new IosPushManager();
