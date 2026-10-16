import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as dates from '../src/utils/dates';
import * as filters from '../src/utils/admin-filters';
import * as phone from '../src/utils/phone';
import * as schoolSettings from '../src/utils/school-settings';

interface ElementNode { type: unknown; props: Record<string, unknown>; children: unknown[] }
function nodes(tree: unknown): ElementNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return [];
  const element = tree as ElementNode;
  return [element, ...element.children.flatMap(nodes)];
}

function harness(file: string, context: object, api: object = {}) {
  const hooks: unknown[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  const react = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
      return { type, props: props || {}, children };
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (value: unknown) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback(callback: unknown) { cursor++; return callback; },
    useEffect(effect: () => void, deps?: unknown[]) {
      const index = cursor++;
      const previous = hooks[index] as unknown[] | undefined;
      if (!previous || !deps || deps.some((entry, offset) => !Object.is(entry, previous[offset]))) effects.push(effect);
      hooks[index] = deps;
    },
  };
  const output: Record<string, (props: object) => ElementNode> = {};
  const source = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, {
    exports: output,
    require(name: string) {
      if (name === 'react') return react;
      if (name === '../context/AppContext') return { useApp: () => context };
      if (name === '../services/api') return { api };
      if (name === '../utils/dates') return dates;
      if (name === '../utils/admin-filters') return filters;
      if (name === '../utils/phone') return phone;
      if (name === '../utils/school-settings') return schoolSettings;
      if (['lucide-react','./ui','./StaffManagement','./ParentManagement','./AuditManagement','./ManagementActions','./BulkRosterImport','./SchoolInfo','./SchoolAdminManagement','./SchoolRequestCenter'].includes(name)) {
        return new Proxy({}, { get: (_, key) => String(key) });
      }
      throw new Error(`Unexpected component dependency: ${name}`);
    },
    document: { addEventListener() {}, removeEventListener() {} },
  });
  return (component: string, props: object) => {
    cursor = 0;
    const tree = nodes(output[component](props));
    effects.splice(0).forEach((effect) => effect());
    return tree;
  };
}

function change(elements: ElementNode[], id: string, value: string) {
  const input = elements.find((element) => element.props.id === id);
  assert(input, 'Expected filter control');
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

async function run() {
  const today = dates.getIstanbulDate();
  const roster = [{ id: 'roster-a', className: '5-A', studentName: 'Student A', parentName: 'Parent A', parentPhone: '', isClaimed: false },
    { id: 'roster-b', className: '6-B', studentName: 'Student B', parentName: 'Parent B', parentPhone: '', isClaimed: false }];
  const admin = harness('src/components/AdminView.tsx', {
    currentSchool: { id: 'local' }, settings: {}, users: [], teachers: [], roster, auditLogs: [], isolationTestResults: [],
    appointments: [{ id: 'today', date: today, startTime: '09:00', status: 'pending' }, { id: 'other', date: '2099-12-31', startTime: '10:00', status: 'pending' }],
  });
  const props = { onClose() {} };
  let elements = admin('AdminView', props);
  change(elements, 'admin-section', 'appointments');
  elements = admin('AdminView', props);
  assert.equal(elements.find((element) => element.props.id === 'admin-appointment-date')?.props.value, today);
  const allButton = elements.find((element) => element.type === 'Button' && element.children.includes('Tüm Randevular'));
  assert(allButton);
  (allButton.props.onClick as () => void)();
  elements = admin('AdminView', props);
  assert.deepEqual(elements.filter((element) => element.type === 'article').map((element) => element.props.key), ['other', 'today']);
  change(elements, 'admin-appointment-date', '2099-12-31');
  elements = admin('AdminView', props);
  assert.deepEqual(elements.filter((element) => element.type === 'article').map((element) => element.props.key), ['other']);
  const todayButton = elements.find((element) => element.type === 'Button' && element.children.includes('Bugün'));
  assert(todayButton);
  (todayButton.props.onClick as () => void)();
  elements = admin('AdminView', props);
  assert.equal(elements.find((element) => element.props.id === 'admin-appointment-date')?.props.value, today);
  change(elements, 'admin-section', 'roster');
  elements = admin('AdminView', props);
  assert.equal(elements.filter((element) => element.type === 'tr').length, 0);
  change(elements, 'parent-class', '5-A');
  elements = admin('AdminView', props);
  assert.deepEqual(elements.filter((element) => element.type === 'tr' && element.props.key).map((element) => element.props.key), ['roster-a']);
  assert.equal(elements.find((element) => element.type === 'ParentManagement')?.props.selectedClass, '5-A');

  const parent = harness('src/components/ParentManagement.tsx', {}, { getManagedParents: async () => ({ parents: [{
    id: 'parent', fullName: 'Fixture Parent', phone: '', status: 'inactive', students: [
      { id: 'child-a', name: 'Child A', className: '5-A' }, { id: 'child-b', name: 'Child B', className: '6-B' },
    ],
  }] }) });
  const parentProps = { schoolId: 'local', roster: [], search: '', selectedClass: '', onClassesChange() {}, onChanged: async () => {}, onIssue() {} };
  parent('ParentManagement', parentProps);
  await new Promise<void>((resolve) => setImmediate(resolve));
  elements = parent('ParentManagement', parentProps);
  assert.equal(elements.filter((element) => element.type === 'article').length, 0);
  elements = parent('ParentManagement', { ...parentProps, selectedClass: '5-A' });
  assert.equal(elements.filter((element) => element.type === 'article').length, 1);
  assert.deepEqual(elements.filter((element) => element.type === 'h4').flatMap((element) => element.children), ['Child A']);
  assert.deepEqual(elements.filter((element) => element.type === 'ManagementActions').map((element) => element.props.id), ['parent','child-a']);

  const bulkRosterSource = fs.readFileSync('src/components/BulkRosterImport.tsx', 'utf8');
  assert.match(bulkRosterSource, /Excel Şablonunu İndir/);
  assert.match(bulkRosterSource, /<Button variant="secondary" disabled=\{busy\} onClick=\{async \(\) => \{/);
  const authSource = fs.readFileSync('src/components/AuthView.tsx', 'utf8');
  assert.match(authSource, /Veli Hesabı Oluştur/);
  assert.match(authSource, /En az 5 karakter/);
  assert.doesNotMatch(authSource, /En az 8 karakter/);
  const parentSource = fs.readFileSync('src/components/ParentManagement.tsx', 'utf8');
  assert.doesNotMatch(parentSource, /Veli Parola Sıfırlama Kodu/);
  const adminSource = fs.readFileSync('src/components/AdminView.tsx', 'utf8');
  assert.doesNotMatch(adminSource, /ACCOUNT_ACTIVATION|PASSWORD_RESET|authCodeRoster|createAuthCode|code-purpose|Parola sıfırlama kodu/);
  console.log('Admin component date picker, today action, class-first roster/parent rendering and child actions PASS (mocked hooks).');
}
run().catch((cause: unknown) => {
  console.error('Admin component filter test FAILED.', cause instanceof Error ? cause.message : 'Unknown error');
  process.exitCode = 1;
});
