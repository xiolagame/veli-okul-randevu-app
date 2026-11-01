export class StaleSchoolReadError extends Error {
  constructor() { super('Read context was invalidated'); this.name='StaleSchoolReadError'; }
}

/** Bounded, memory-only data cache. Never stores credentials or grants authority. */
export class SchoolReadCache {
  private scope = '';
  private generation = 0;
  private entries = new Map<string, { data: unknown; at: number }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private now = () => Date.now(), readonly freshMs = 30_000, readonly retainMs = 300_000) {}

  clear() { this.generation++; this.entries.clear(); this.pending.clear(); }
  private activate(scope: string) { if (this.scope !== scope) { this.clear(); this.scope = scope; } }
  peek<T>(scope: string, key: string): T | undefined {
    if (scope !== this.scope) return undefined;
    const value = this.entries.get(key);
    if (!value) return undefined;
    if (this.now() - value.at >= this.retainMs) { this.entries.delete(key); return undefined; }
    return value.data as T;
  }
  get<T>(scope: string, key: string, load: () => Promise<T>): Promise<T> {
    this.activate(scope);
    const previous = this.peek<T>(scope, key);
    if (previous !== undefined && this.now() - this.entries.get(key)!.at < this.freshMs) return Promise.resolve(previous);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight as Promise<T>;
    const generation = this.generation;
    const result = Promise.resolve().then(load).then(data => {
      if (generation !== this.generation || scope !== this.scope) throw new StaleSchoolReadError();
      {
        this.entries.delete(key);
        this.entries.set(key, { data, at: this.now() });
        while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
      }
      return data;
    }).finally(() => { if (this.pending.get(key) === result) this.pending.delete(key); });
    this.pending.set(key, result);
    return result;
  }
}
export const schoolReadCache = new SchoolReadCache();

// Deliberately excludes OTP, QR, previews/challenges, audit, push and public APIs.
export function isSchoolReadCacheable(endpoint: string) {
  return /^\/api\/schools\/[^/]+\/(?:info|teachers|users\?role=security|appointments|requests|management\/(?:student-records|admins|operations(?:\?.*)?))$/.test(endpoint);
}
