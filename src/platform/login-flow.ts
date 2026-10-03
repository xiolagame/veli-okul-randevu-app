import { ApiError } from './api-error';
import type { AuthSessionManager } from './auth-session';

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'SESSION_BOOTSTRAP_FAILED' };

export async function performLogin<Response extends { token: string }>(options: {
  authenticate: () => Promise<Response>;
  bootstrap: (response: Response) => Promise<void>;
  session: Pick<AuthSessionManager, 'setToken' | 'getToken' | 'clearTokenIfCurrent'>;
  clearRuntimeSession: () => void;
}): Promise<LoginResult> {
  let response: Response;
  try {
    response = await options.authenticate();
  } catch (error) {
    return { ok: false, reason: error instanceof ApiError && error.status === 401 ? 'INVALID_CREDENTIALS' : 'SESSION_BOOTSTRAP_FAILED' };
  }

  try {
    await options.session.setToken(response.token);
    await options.bootstrap(response);
    return { ok: true };
  } catch {
    try {
      await options.session.clearTokenIfCurrent(response.token);
    } finally {
      if (!await options.session.getToken()) options.clearRuntimeSession();
    }
    return { ok: false, reason: 'SESSION_BOOTSTRAP_FAILED' };
  }
}
