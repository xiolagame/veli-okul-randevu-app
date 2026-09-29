const PRODUCTION_PUBLIC_ORIGIN = 'https://velirandevu.com';
const LOCAL_PUBLIC_ORIGIN = 'http://localhost:3000';

function normalizeOrigin(value: string | undefined, allowLocalHttp: boolean): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const isLocalHttp = allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !isLocalHttp) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicOrigin(): string {
  const configured = normalizeOrigin(process.env.EMAIL_PUBLIC_ORIGIN, true);
  if (configured) return configured;
  const netlifyOrigin = normalizeOrigin(process.env.URL, false);
  if (netlifyOrigin) return netlifyOrigin;
  return process.env.NODE_ENV === 'production' ? PRODUCTION_PUBLIC_ORIGIN : LOCAL_PUBLIC_ORIGIN;
}
