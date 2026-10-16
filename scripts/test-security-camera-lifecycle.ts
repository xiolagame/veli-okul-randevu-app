import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dates from '../src/utils/dates';

interface ElementNode { type: unknown; props: Record<string, unknown>; children: unknown[] }
interface EffectHook { deps?: unknown[]; cleanup?: () => void }

const hooks: unknown[] = [];
let cursor = 0;
let verifies = 0;
let starts = 0;
let stops = 0;
let destroys = 0;
let permissionChecks = 0;
let permissionRequests = 0;
let settingsOpens = 0;
let lifecycleUnsubscribes = 0;
let permissionState = 'prompt';
let permissionAfterRequest = 'granted';
let lifecycleListener: ((state: 'ACTIVE' | 'INACTIVE') => void) | null = null;
let resolveBlockedStart: (() => void) | null = null;
let blockNextStart = false;
const backHandlers: Array<() => void> = [];
const scanners: FakeScanner[] = [];

class FakeScanner {
  constructor(public video: unknown, public callback: (result: { data: string }) => void) { scanners.push(this); }
  async start() {
    starts += 1;
    if (!blockNextStart) return;
    blockNextStart = false;
    await new Promise<void>((resolve) => { resolveBlockedStart = resolve; });
  }
  stop() { stops += 1; }
  destroy() { destroys += 1; }
}

const react = {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
    return { type, props: props || {}, children };
  },
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], (value: unknown) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
  },
  useRef(initial: unknown) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { current: initial };
    return hooks[index];
  },
  useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const index = cursor++;
    const previous = hooks[index] as EffectHook | undefined;
    const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, dependencyIndex) => !Object.is(value, previous.deps?.[dependencyIndex]));
    if (!changed) return;
    previous?.cleanup?.();
    const cleanup = effect();
    hooks[index] = { deps: deps ? [...deps] : undefined, cleanup: cleanup || undefined } satisfies EffectHook;
  },
};

const result = { allowed: false, decision: 'INVALID', title: 'GEÇERSİZ QR KODU', message: 'Bu QR koduyla geçerli bir randevu bulunamadı.' };
const context = {
  appointments: [], settings: { schoolName: 'Fixture' },
  verifySecurityQr: async () => { verifies += 1; return result; },
};
const cameraPermission = {
  requiresNativePermission: () => true,
  check: async () => { permissionChecks += 1; return { state: permissionState }; },
  request: async () => {
    permissionRequests += 1;
    permissionState = permissionAfterRequest;
    return { state: permissionState };
  },
  openSettings: async () => { settingsOpens += 1; },
};
const lifecycle = {
  getCurrentState: () => 'ACTIVE',
  subscribe(listener: (state: 'ACTIVE' | 'INACTIVE') => void) {
    lifecycleListener = listener;
    return () => { lifecycleUnsubscribes += 1; lifecycleListener = null; };
  },
};
const output: { SecurityView?: (props: Record<string, unknown>) => ElementNode } = {};
const source = fs.readFileSync('src/components/SecurityView.tsx', 'utf8');
const apiSource = fs.readFileSync('src/services/api.ts', 'utf8');
assert.doesNotMatch(source, /checkInVisitor|checkOutVisitor|Giriş(?:i)? Kaydet|QR Doğrula|>QR doğrula<|Ziyareti Tamamla|inputCode/);
assert.match(source, /QR doğrulaması randevu kaydını değiştirmez\./);
assert.match(source, /cameraPermission\.request\(\)/);
assert.match(source, /appLifecycle|lifecycle\.subscribe/);
assert.match(source, /registerBackHandler/);
assert.doesNotMatch(source, /FormData|toBlob|getImageData|drawImage|<canvas|console\.(?:log|error)|localStorage|sessionStorage/);
assert.match(apiSource, /\/schools\/\$\{schoolId\}\/security\/qr\/verify/);
assert.match(apiSource, /\{ qrToken \}/);
assert.equal(dates.formatAppointmentDateTime('2026-09-27', '14:40'), '14:40 27.09.2026');

const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
vm.runInNewContext(javascript, {
  exports: output,
  require(name: string) {
    if (name === 'react') return react;
    if (name === 'qr-scanner') return FakeScanner;
    if (name.includes('AppContext')) return { useApp: () => context };
    if (name.includes('mockData')) return { getTodayDateString: () => '2090-01-02' };
    if (name === '../utils/dates') return dates;
    if (name.includes('android-camera-permission')) return { androidCameraPermission: cameraPermission };
    if (name.includes('runtime-platform')) return { getRuntimePlatform: () => 'ANDROID' };
    if (name.includes('/lifecycle')) return { appLifecycle: lifecycle };
    if (name.includes('back-navigation')) return {
      registerBackHandler(handler: () => void) {
        backHandlers.push(handler);
        return () => { const index = backHandlers.indexOf(handler); if (index >= 0) backHandlers.splice(index, 1); };
      },
    };
    if (name === './ui' || name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error(`Unexpected dependency: ${name}`);
  },
  window: { isSecureContext: true },
  navigator: { mediaDevices: { getUserMedia() {} }, permissions: { query: async () => ({ state: 'granted' }) } },
});

const video = {};
function nodes(tree: unknown): ElementNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return [];
  const element = tree as ElementNode;
  return [element, ...element.children.flatMap(nodes)];
}
function render() {
  cursor = 0;
  assert(output.SecurityView);
  const elements = nodes(output.SecurityView({ cameraPermission, lifecycle }));
  const videos = elements.filter((element) => element.type === 'video');
  assert.equal(videos.length, 1, 'The video must remain mounted during verification and results');
  (videos[0].props.ref as { current: unknown }).current = video;
  return elements;
}
function findButton(elements: ElementNode[], label: string) {
  const button = elements.find((element) => element.type === 'Button' && element.children.includes(label));
  assert(button, `Expected action: ${label}`);
  return button.props.onClick as () => Promise<void> | void;
}
async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function invokeBackHandler() {
  const handler = backHandlers.at(-1);
  assert(handler, 'Expected an active back handler');
  handler();
}
function unmount() {
  for (const hook of hooks) (hook as EffectHook | undefined)?.cleanup?.();
}

async function run() {
  let elements = render();
  assert.equal(permissionChecks, 0, 'Permission must not be checked on mount');
  assert.equal(permissionRequests, 0, 'Permission must not be requested on mount');
  assert.equal(starts, 0, 'Camera must not start on mount');

  blockNextStart = true;
  findButton(elements, 'QR Kod Tara')();
  await settle();
  assert.equal(permissionChecks, 1);
  assert.equal(permissionRequests, 1);
  assert.equal(starts, 1, 'Camera starts only after the user action and permission grant');
  elements = render();
  invokeBackHandler();
  resolveBlockedStart?.();
  resolveBlockedStart = null;
  await settle();
  elements = render();
  findButton(elements, 'QR Kod Tara');
  assert.equal(starts, 1, 'A late start result must not reactivate a stopped scanner');

  findButton(elements, 'QR Kod Tara')();
  await settle();
  elements = render();
  findButton(elements, 'Taramayı durdur');
  assert.equal(starts, 2);
  lifecycleListener?.('INACTIVE');
  assert(stops >= 2, 'Inactive lifecycle must stop the scanner');
  lifecycleListener?.('ACTIVE');
  await settle();
  elements = render();
  assert.equal(starts, 3, 'An active scanner resumes after controlled foreground return');

  findButton(elements, 'Taramayı durdur')();
  elements = render();
  lifecycleListener?.('INACTIVE');
  lifecycleListener?.('ACTIVE');
  await settle();
  assert.equal(starts, 3, 'Manual stop must clear foreground resume intent');

  permissionState = 'permanently-denied';
  elements = render();
  findButton(elements, 'QR Kod Tara')();
  await settle();
  elements = render();
  assert.equal(permissionRequests, 1, 'Permanent denial must not trigger another OS prompt');
  findButton(elements, 'Ayarları Aç')();
  await settle();
  assert.equal(settingsOpens, 1);
  lifecycleListener?.('INACTIVE');
  permissionState = 'granted';
  lifecycleListener?.('ACTIVE');
  await settle();
  elements = render();
  assert.equal(starts, 4, 'Settings return with granted permission resumes the requested scan');

  assert.equal(scanners.length, 1, 'Scanner restarts must reuse one scanner instance');
  scanners[0].callback({ data: 'local-test-only' });
  scanners[0].callback({ data: 'local-test-only' });
  await settle();
  elements = render();
  assert.equal(verifies, 1, 'Duplicate scans must produce one verification request');
  invokeBackHandler();
  elements = render();
  findButton(elements, 'QR Kod Tara');

  unmount();
  assert.equal(destroys, 1, 'Unmount must destroy the scanner');
  assert.equal(lifecycleUnsubscribes, 1, 'Unmount must remove the lifecycle listener');
  assert.equal(backHandlers.length, 0, 'Unmount must remove the back handler');
  console.log('Security camera permission, lifecycle, back handling, race protection and duplicate verification tests PASS. Hardware not tested.');
}

run().catch((cause: unknown) => {
  console.error('Security camera lifecycle FAILED.', cause instanceof Error ? cause.message : 'Unknown error');
  process.exitCode = 1;
});
