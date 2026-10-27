/** Display only. Server-side resend and challenge expiry remain authoritative. */
export function remainingResendSeconds(availableAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}
