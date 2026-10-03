import { browserLifecycle } from './browser-lifecycle';
import { createNativeLifecycleAdapter } from './native-lifecycle';
import { isNativeRuntime } from './runtime-platform';

export const appLifecycle = isNativeRuntime() ? createNativeLifecycleAdapter() : browserLifecycle;
