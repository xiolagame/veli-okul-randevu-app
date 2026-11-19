import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function compile(entry) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external: ['react'],
    plugins: [{ name: 'isolated-auth-ui', setup(builder) {
      builder.onResolve({ filter: /./ }, ({ path: specifier, importer }) => {
        if (!importer.endsWith(entry.replace('src/components/', ''))) return;
        const mocks = {
          '../context/AppContext': 'export const useApp=()=>globalThis.__test.app;',
          '../services/api': 'export const api=globalThis.__test.api;',
          '../platform/runtime-platform': 'export const getRuntimePlatform=()=>globalThis.__test.platform;',
          './ui': `import React from 'react';
            export const Brand=()=>React.createElement('span',null,'Veli Randevu');
            export const Button=({children,...props})=>React.createElement('button',props,children);
            export const Alert=({children,tone})=>React.createElement('div',{'data-tone':tone},children);
            export const Dialog=({children})=>React.createElement('section',null,children);`,
        };
        if (entry.endsWith('AuthView.tsx')) {
          mocks['./PhoneCentricLoginPanel'] = `import React from 'react'; export const PhoneCentricLoginPanel=(props)=>React.createElement('section',{'data-mode':'phone','data-fallback':String(props.allowLegacyFallback)},React.createElement('button',null,'WhatsApp Kodu Gönder'));`;
          mocks['./UnifiedWhatsAppLoginPanel'] = `import React from 'react'; export const UnifiedWhatsAppLoginPanel=()=>React.createElement('section',null,'Parola ile giriş','Platform Yönetimi');`;
          mocks['./WhatsAppAuthPanel'] = `import React from 'react'; export const WhatsAppAuthPanel=()=>React.createElement('section',null,'Parola ile giriş');`;
        }
        if (mocks[specifier]) return { path: specifier, namespace: 'auth-mock', pluginData: mocks[specifier] };
      });
      builder.onLoad({ filter: /.*/, namespace: 'auth-mock' }, ({ pluginData }) => ({ contents: pluginData }));
    } }],
  });
  return result.outputFiles[0].text;
}

function mount(code, name, props, settings) {
  const state = [];
  const effects = [];
  let cursor = 0;
  const deps = new Map();
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef: () => ({ current: null }),
    useEffect(effect, inputs) {
      const index = cursor++;
      if (!deps.has(index) || inputs.some((value, i) => deps.get(index)[i] !== value)) {
        deps.set(index, inputs);
        effects.push(effect);
      }
    },
  };
  const output = { exports: {} };
  vm.runInNewContext(code, { module: output, exports: output.exports, __test: settings, window: {}, Error,
    require: (specifier) => specifier === 'react' ? react : require(specifier) });
  const render = () => { cursor = 0; return output.exports[name](props); };
  return { state, render, flush: async () => {
    effects.splice(0).forEach((effect) => effect());
    await new Promise(setImmediate);
  } };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

const auth = await compile('src/components/AuthView.tsx');
for (const scenario of [
  { platform: 'WEB', phone: true, fallback: false },
  { platform: 'WEB', phone: false },
  { platform: 'ANDROID', phone: true, fallback: true },
  { platform: 'IOS', phone: true, fallback: true },
]) {
  const harness = mount(auth, 'AuthView', {}, { platform: scenario.platform, app: {}, api: {
    getAuthCapabilities: async () => ({ whatsappAuthEnabled: true, unifiedLoginEnabled: true, phoneCentricAuthEnabled: scenario.phone }),
  } });
  const initial = renderToStaticMarkup(harness.render());
  if (scenario.platform === 'WEB') assert(!initial.includes('Parola ile giriş'));
  await harness.flush();
  const html = renderToStaticMarkup(harness.render());
  if (scenario.phone) {
    assert(html.includes('WhatsApp Kodu Gönder'));
    assert(html.includes(`data-fallback="${scenario.fallback}"`));
    assert(!html.includes('Parola ile giriş'));
    assert(!html.includes('Platform Yönetimi'));
    assert(!html.includes('login-password'));
    if (scenario.platform === 'WEB') {
      harness.state[6] = 'platform'; // A stale legacy selection cannot override web phone mode.
      assert(!renderToStaticMarkup(harness.render()).includes('login-password'));
    }
  } else if (scenario.platform === 'WEB') {
    assert(html.includes('WhatsApp ile giriş şu anda kullanılamıyor.'));
    assert(!html.includes('Parola ile giriş'));
    assert(!html.includes('Platform Yönetimi'));
    assert(!html.includes('login-password'));
  } else {
    assert(html.includes('Parola ile giriş'));
    assert(html.includes('Platform Yönetimi'));
  }
}
const unavailable = mount(auth, 'AuthView', {}, { platform: 'WEB', app: {}, api: {
  getAuthCapabilities: async () => { throw new Error('Synthetic network failure'); },
} });
unavailable.render(); await unavailable.flush();
const unavailableHtml = renderToStaticMarkup(unavailable.render());
assert(unavailableHtml.includes('Giriş seçenekleri alınamadı'));
assert(!unavailableHtml.includes('login-password'));

const panel = await compile('src/components/PhoneCentricLoginPanel.tsx');
let fallbackCalls = 0;
let requestFailure = false;
const settings = { app: {}, api: { requestPhoneCentricCode: async () => {
  if (requestFailure) throw new Error('Çok fazla istek. Lütfen daha sonra tekrar deneyin.');
  return { attemptId: 'synthetic-attempt', challengeId: 'synthetic-challenge', resendAfterSeconds: 0,
    message: 'Kod gönderilebildiyse kısa süre içinde WhatsApp hesabınıza ulaşacaktır.' };
} } };
const scanner = mount(panel, 'PhoneCentricLoginPanel', { allowLegacyFallback: false, onLegacyFallback: () => { fallbackCalls += 1; } }, settings);
let tree = scanner.render();
find(tree, (node) => node.type === 'input' && node.props.type === 'tel').props.onChange({ target: { value: '05551234567' } });
tree = scanner.render();
await find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
tree = scanner.render();
const html = renderToStaticMarkup(tree);
assert(html.includes('Lütfen telefonunuza gelen WhatsApp onay kodunu girin.'));
assert(html.includes('data-tone="info"'));
assert(!html.includes('Kod gönderilebildiyse'));
assert(html.includes('phone-centric-code'));
requestFailure = true;
await find(tree, (node) => node.type === 'button' && node.props.children === 'Kodu yeniden gönder').props.onClick();
const failedHtml = renderToStaticMarkup(scanner.render());
assert(failedHtml.includes('Çok fazla istek.'));
assert(!failedHtml.includes('Lütfen telefonunuza gelen'));

let verificationFailure = true;
let loginCalls = 0;
settings.app.whatsappLogin = async () => { loginCalls += 1; return { ok: true }; };
settings.api.verifyPhoneCentricCode = async () => {
  if (verificationFailure) throw new Error('Kod geçersiz veya süresi dolmuş olabilir.');
  return { pendingEmail: true, requiresSchoolCode: false, message: 'Bağımsız e-posta kodunu girin.' };
};
tree = scanner.render();
find(tree, (node) => node.type === 'input' && node.props.id === 'phone-centric-code').props.onChange({ target: { value: '123456' } });
await find(scanner.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert(renderToStaticMarkup(scanner.render()).includes('Kod geçersiz'));
assert.equal(loginCalls, 0);
verificationFailure = false;
await find(scanner.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
tree = scanner.render();
assert(renderToStaticMarkup(tree).includes('phone-centric-email-code'));
assert.equal(loginCalls, 0, 'Platform first factor cannot establish a session');
settings.api.verifyPhoneCentricEmail = async () => ({ token: 'synthetic-session', user: {}, memberships: [] });
find(tree, (node) => node.type === 'input' && node.props.id === 'phone-centric-email-code').props.onChange({ target: { value: '654321' } });
await find(scanner.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert.equal(loginCalls, 1);

settings.api.requestPhoneCentricCode = async () => ({ legacyFallbackRequired: true });
const denied = mount(panel, 'PhoneCentricLoginPanel', { allowLegacyFallback: false, onLegacyFallback: () => { fallbackCalls += 1; } }, settings);
tree = denied.render();
find(tree, (node) => node.type === 'input' && node.props.type === 'tel').props.onChange({ target: { value: '05551234567' } });
await find(denied.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert.equal(fallbackCalls, 0);
assert(renderToStaticMarkup(denied.render()).includes('WhatsApp girişi şu anda kullanılamıyor'));
console.log('Phone-centric web UI: capability loading/error/selection, passwordless mode, native fallback preservation, OTP instruction and request/resend errors PASS.');
