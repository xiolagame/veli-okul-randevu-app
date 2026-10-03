import { browserNetwork } from './browser-network';
import { createNativeNetworkAdapter } from './native-network';
import { isNativeRuntime } from './runtime-platform';

export const networkHint = isNativeRuntime() ? createNativeNetworkAdapter() : browserNetwork;
