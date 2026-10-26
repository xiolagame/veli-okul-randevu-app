// Scope-local handles only; codes and credentials are never persisted here.
export class MultiClassChallengeGuard {
  private challengeId = '';
  private closed = false;
  private cancelling: Promise<void> | null = null;
  constructor(private readonly cancelRemote: (id: string) => Promise<unknown>) {}
  get isDisposed() { return this.closed; }
  attach(id: string) {
    this.challengeId = id;
    if (this.closed) void this.cancel().catch(() => { /* Server expiry remains authoritative. */ });
  }
  forget(id: string) { if (this.challengeId === id) this.challengeId = ''; }
  async cancel(): Promise<void> {
    if (this.cancelling) { await this.cancelling; if (this.challengeId) return this.cancel(); return; }
    const id = this.challengeId;
    if (!id) return;
    const attempt = this.cancelRemote(id).then(() => this.forget(id));
    this.cancelling = attempt;
    try { await attempt; } finally { if (this.cancelling === attempt) this.cancelling = null; }
    if (this.challengeId) await this.cancel();
  }
  dispose() {
    this.closed = true;
    void this.cancel().catch(() => { /* Best effort on unmount; never claim confirmed cancellation. TTL: 5 minutes. */ });
  }
}
