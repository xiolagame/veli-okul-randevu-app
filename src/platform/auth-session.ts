import { AuthTokenStore } from './auth-token-store';
import { runtimeAuthTokenStore } from './auth-token-store-selection';

export type SessionInvalidationReason = 'unauthorized';
export type SessionInvalidationListener = (reason: SessionInvalidationReason) => void;

export class AuthSessionManager {
  private token: string | null = null;
  private hydrationPromise: Promise<string | null> | null = null;
  private hydrated = false;
  private invalidationPromise: Promise<void> | null = null;
  private storeMutation: Promise<void> = Promise.resolve();
  private revision = 0;
  private listeners = new Set<SessionInvalidationListener>();

  constructor(private readonly store: AuthTokenStore) {}

  async hydrate(): Promise<string | null> {
    if (this.hydrated) return this.token;
    if (!this.hydrationPromise) {
      const hydrationRevision = this.revision;
      const hydrationRead = this.storeMutation.then(() => this.store.get());
      this.storeMutation = hydrationRead.then(() => {}, () => {});
      this.hydrationPromise = hydrationRead.then((token) => {
        if (this.revision === hydrationRevision) {
          this.token = token;
          this.hydrated = true;
        }
        return this.token;
      }).finally(() => {
        this.hydrationPromise = null;
      });
    }
    return this.hydrationPromise;
  }

  async getToken(): Promise<string | null> {
    return this.hydrate();
  }

  async setToken(token: string): Promise<void> {
    const revision = ++this.revision;
    this.token = token;
    this.hydrated = true;
    try {
      await this.mutateStore(() => this.store.set(token));
    } catch (error) {
      if (this.revision === revision) this.token = null;
      throw error;
    }
  }

  async clearToken(): Promise<void> {
    const previousToken = this.token;
    const revision = ++this.revision;
    this.token = null;
    this.hydrated = true;
    try {
      await this.mutateStore(() => this.store.remove());
    } catch (error) {
      if (this.revision === revision) this.token = previousToken;
      throw error;
    }
  }

  async clearTokenAfterRemoteInvalidation(): Promise<void> {
    this.revision += 1;
    this.token = null;
    this.hydrated = true;
    await this.mutateStore(() => this.store.remove());
  }

  async clearTokenIfCurrent(expectedToken: string): Promise<boolean> {
    if (this.token !== expectedToken) return false;
    this.revision += 1;
    this.token = null;
    this.hydrated = true;
    await this.mutateStore(() => this.store.remove());
    return true;
  }

  async invalidateRejectedToken(rejectedToken: string): Promise<void> {
    const currentToken = await this.getToken();
    if (!currentToken || currentToken !== rejectedToken) return;
    if (this.invalidationPromise) return this.invalidationPromise;

    const invalidationRevision = ++this.revision;
    this.token = null;
    this.hydrated = true;
    this.invalidationPromise = (async () => {
      await this.mutateStore(async () => {
        if (this.revision === invalidationRevision && this.token === null) await this.store.remove();
      });
      if (this.revision !== invalidationRevision || this.token !== null) return;
      for (const listener of this.listeners) listener('unauthorized');
    })().finally(() => {
      this.invalidationPromise = null;
    });

    return this.invalidationPromise;
  }

  subscribe(listener: SessionInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private mutateStore(operation: () => Promise<void>): Promise<void> {
    const mutation = this.storeMutation.then(operation, operation);
    this.storeMutation = mutation.catch(() => {});
    return mutation;
  }
}

export const authSession = new AuthSessionManager(runtimeAuthTokenStore);
