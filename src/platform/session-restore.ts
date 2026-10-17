export type SessionRestoreResult = 'NO_SESSION' | 'RESTORED' | 'RETRYABLE_FAILURE' | 'SESSION_CHANGED';

interface ExistingSession {
  hydrate(): Promise<string | null>;
  getToken(): Promise<string | null>;
}

export function loadVerifiedSessionPrerequisites<TIdentity, TAccess>(
  identity: () => Promise<TIdentity>,
  access: () => Promise<TAccess>,
): Promise<[TIdentity, TAccess]> {
  return Promise.all([identity(), access()]);
}

export async function restoreExistingSession(options: {
  session: ExistingSession;
  bootstrap: (token: string) => Promise<void>;
  onHydrationDuration?: (durationMs: number) => void;
}): Promise<SessionRestoreResult> {
  const hydrationStarted = performance.now();
  const token = await options.session.hydrate().finally(() => options.onHydrationDuration?.(performance.now() - hydrationStarted));
  if (!token) return 'NO_SESSION';

  try {
    await options.bootstrap(token);
    return await options.session.getToken() === token ? 'RESTORED' : 'SESSION_CHANGED';
  } catch {
    return await options.session.getToken() === token ? 'RETRYABLE_FAILURE' : 'SESSION_CHANGED';
  }
}
