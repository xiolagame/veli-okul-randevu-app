import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dates from '../src/utils/dates';

interface ElementNode { type: unknown; props: Record<string, unknown>; children: unknown[] }
const hooks: unknown[] = [];
const cleanups: Array<() => void> = [];
let cursor = 0;
let verifies = 0;
let starts = 0;
let stops = 0;
let destroys = 0;
const scanners: FakeScanner[] = [];
class FakeScanner {
  constructor(public video: unknown, public callback: (result: { data: string }) => void) { scanners.push(this); }
  async start() { starts++; }
  stop() { stops++; }
  destroy() { destroys++; }
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
  useEffect(effect: () => () => void) {
    const index = cursor++;
    if (!(index in hooks)) { hooks[index] = true; cleanups.push(effect()); }
  },
};
const result = { allowed: false, decision: 'INVALID', title: 'GEÇERSİZ QR KOD', message: 'Giriş vermeyin.' };
const context = {
  appointments: [], settings: { schoolName: 'Fixture' },
  verifySecurityQr: async () => { verifies++; return result; },
};
const output: { SecurityView?: () => ElementNode } = {};
const source = fs.readFileSync('src/components/SecurityView.tsx', 'utf8');
assert.doesNotMatch(source, /checkOutVisitor|Çıkışı kaydet|Ziyareti Tamamla/);
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
    if (name === './ui' || name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error('Unexpected dependency');
  },
  window: { isSecureContext: true },
  navigator: { mediaDevices: { getUserMedia() {} } },
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
  const elements = nodes(output.SecurityView());
  const videos = elements.filter((element) => element.type === 'video');
  assert.equal(videos.length, 1, 'The video must remain mounted during verification and results');
  (videos[0].props.ref as { current: unknown }).current = video;
  return elements;
}
function findButton(elements: ElementNode[], label: string) {
  const button = elements.find((element) => element.type === 'Button' && element.children.includes(label));
  assert(button, 'Expected scanner action');
  return button.props.onClick as () => Promise<void> | void;
}
async function run() {
  let elements = render();
  await findButton(elements, 'QR Kod Tara')();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let cycle = 0; cycle < 5; cycle++) {
    assert.equal(scanners.length, 1, 'Restart must reuse the scanner');
    scanners[0].callback({ data: 'local-test-only' });
    scanners[0].callback({ data: 'local-test-only' });
    render();
    await new Promise<void>((resolve) => setImmediate(resolve));
    elements = render();
    assert.equal(verifies, cycle + 1, 'Duplicate scan must not duplicate verification');
    await findButton(elements, 'Yeni QR Tara')();
    await new Promise<void>((resolve) => setImmediate(resolve));
    elements = render();
  }
  assert.equal(starts, 6);
  assert.equal(stops, 5);
  assert.equal(destroys, 0);
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(destroys, 1);
  console.log('QR mocked component lifecycle: five scan/restart cycles, mounted video, duplicate guard and cleanup PASS. Hardware not tested.');
}
run().catch((cause: unknown) => {
  console.error('QR mocked lifecycle FAILED.', cause instanceof Error ? cause.message : 'Unknown error');
  process.exitCode = 1;
});
