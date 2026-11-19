import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { createNativeNetworkAdapter } from '../src/platform/native-network';
import { createNativeLifecycleAdapter } from '../src/platform/native-lifecycle';
import { subscribeToNativeNavigationIntents } from '../src/platform/native-navigation-intent';
import { pendingNavigationIntent } from '../src/platform/navigation-intent';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const failures: string[] = [];
async function scenario(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${(error as Error).message}`); }
}

await scenario('network initial query cannot overwrite a newer connectivity event', async () => {
  const initial = deferred<{ connected: boolean }>();
  let event!: (state: { connected: boolean }) => void;
  const adapter = createNativeNetworkAdapter({ getStatus: () => initial.promise, addListener: async (_, callback) => { event = callback; return { remove: async () => {} }; } });
  const dispose = adapter.subscribe(() => {});
  event({ connected: false }); initial.resolve({ connected: true }); await tick();
  assert.equal(adapter.getCurrentHint(), 'DISCONNECTED'); dispose();
});
await scenario('lifecycle initial query cannot overwrite a newer background event', async () => {
  const initial = deferred<{ isActive: boolean }>();
  let event!: (state: { isActive: boolean }) => void;
  const adapter = createNativeLifecycleAdapter({ getState: () => initial.promise, addListener: async (_, callback) => { event = callback; return { remove: async () => {} }; } });
  const dispose = adapter.subscribe(() => {});
  event({ isActive: false }); initial.resolve({ isActive: true }); await tick();
  assert.equal(adapter.getCurrentState(), 'INACTIVE'); dispose();
});
await scenario('native initial state notifies subscribers and disposed listeners stay silent', async () => {
  const initial = deferred<{ connected: boolean }>();
  let event!: (state: { connected: boolean }) => void;
  const adapter = createNativeNetworkAdapter({ getStatus: () => initial.promise, addListener: async (_, callback) => { event = callback; return { remove: async () => {} }; } });
  const seen: string[] = []; const dispose = adapter.subscribe((state) => seen.push(state));
  initial.resolve({ connected: false }); await tick(); assert.deepEqual(seen, ['DISCONNECTED']);
  dispose(); event({ connected: true }); assert.deepEqual(seen, ['DISCONNECTED']);
});
await scenario('plugin read/listener/remove failures do not become unhandled rejections', async () => {
  const errors: unknown[] = []; const rejected = (error: unknown) => errors.push(error);
  process.on('unhandledRejection', rejected);
  try {
    const fail = async () => { throw Error('synthetic plugin unavailable'); };
    const network = createNativeNetworkAdapter({ getStatus: fail, addListener: fail });
    const lifecycle = createNativeLifecycleAdapter({ getState: fail, addListener: fail });
    const a = network.subscribe(() => {}), b = lifecycle.subscribe(() => {});
    await tick(); a(); b(); await tick();
    const delayed = deferred<{ remove(): Promise<void> }>();
    const pending = createNativeNetworkAdapter({ getStatus: async () => ({ connected: true }), addListener: () => delayed.promise });
    const c = pending.subscribe(() => {}); c(); delayed.resolve({ remove: fail }); await tick(); await tick();
    assert.deepEqual(errors, []);
  } finally { process.off('unhandledRejection', rejected); }
});
await scenario('warm native links notify mounted navigation and ignore untrusted/disposed events', async () => {
  const originalPlatform = Capacitor.getPlatform;
  const originalWindow = globalThis.window;
  Capacitor.getPlatform = () => 'android';
  const target = new EventTarget();
  Object.assign(globalThis, { window: target });
  let event!: (state: { url: string }) => void;
  let notifications = 0; target.addEventListener('veli:navigation-intent', () => notifications++);
  try {
    pendingNavigationIntent.clear();
    const dispose = subscribeToNativeNavigationIntents(undefined, { getLaunchUrl: async () => undefined, addListener: async (_, callback) => { event = callback; return { remove: async () => {} }; } });
    await tick(); event({ url: 'https://velirandevu.com/app/appointments/synthetic-appointment' });
    assert.equal(notifications, 1); assert.equal(pendingNavigationIntent.peek()?.type, 'APPOINTMENT');
    event({ url: 'https://example.test/app/appointments/foreign' }); assert.equal(notifications, 1);
    dispose(); pendingNavigationIntent.clear(); event({ url: 'https://velirandevu.com/app/notifications' });
    assert.equal(notifications, 1); assert.equal(pendingNavigationIntent.peek(), null);
  } finally { pendingNavigationIntent.clear(); Capacitor.getPlatform = originalPlatform; Object.assign(globalThis, { window: originalWindow }); }
});
if (failures.length) throw Error(`${failures.length} native resilience scenarios failed`);
