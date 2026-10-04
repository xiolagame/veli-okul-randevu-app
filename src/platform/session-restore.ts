export type SessionRestoreResult = 'NO_SESSION' | 'RESTORED' | 'RETRYABLE_FAILURE' | 'SESSION_CHANGED';

interface ExistingSession {
  hydrate(): Promise<string | null>;
  getToken(): Promise<string | null>;
}

export async function restoreExistingSession(options: {
  session: ExistingSession;
  bootstrap: (token: string) => Promise<void>;
}): Promise<SessionRestoreResult> {
  const token = await options.session.hydrate();
  if (!token) return 'NO_SESSION';

  try {
    await options.bootstrap(token);
    return await options.session.getToken() === token ? 'RESTORED' : 'SESSION_CHANGED';
  } catch {
    return await options.session.getToken() === token ? 'RETRYABLE_FAILURE' : 'SESSION_CHANGED';
  }
}
