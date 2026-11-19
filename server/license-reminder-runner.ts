import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

function signature(timestamp: string, nonce: string): string {
  const secret = process.env.AUTH_CODE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('LICENSE_JOB_AUTH_UNAVAILABLE');
  return createHmac('sha256', secret).update(`license-reminder-worker:${timestamp}:${nonce}`).digest('hex');
}
export function createLicenseWorkerRequest(now = Date.now()): Request {
  const origin = new URL(process.env.URL || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.search || origin.hash
      || !['velirandevu.com', 'veliokul.netlify.app'].includes(origin.hostname)) throw new Error('LICENSE_JOB_ORIGIN_INVALID');
  const timestamp = String(now), nonce = randomUUID();
  return new Request(new URL('/.netlify/functions/license-reminders-background', origin), {
    method: 'POST', headers: { 'x-license-job-time': timestamp, 'x-license-job-nonce': nonce,
      'x-license-job-signature': signature(timestamp, nonce) }, signal: AbortSignal.timeout(10_000),
  });
}
export function authorizeLicenseWorker(request: Request, now = Date.now()): boolean {
  if (request.method !== 'POST') return false;
  const timestamp = request.headers.get('x-license-job-time') || '', nonce = request.headers.get('x-license-job-nonce') || '';
  const supplied = request.headers.get('x-license-job-signature') || '';
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(supplied)
      || now - Number(timestamp) > 120_000 || Number(timestamp) - now > 30_000) return false;
  try { return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(timestamp, nonce), 'hex')); }
  catch { return false; }
}
