export interface RejectedTokenInvalidator {
  invalidateRejectedToken(token: string): Promise<void>;
}

export function isAuthenticatedApiEndpoint(endpoint: string): boolean {
  const pathname = endpoint.split(/[?#]/, 1)[0];
  const publicEndpoints = new Set(['/api/public/school-context', '/api/public/requests']);
  // This authenticated preference route lives under /auth; keep OTP routes public.
  if (/^\/api\/auth\/me\/license-reminder-preferences\/[^/]+$/.test(pathname)) return true;
  return !pathname.startsWith('/api/auth/')
    && !publicEndpoints.has(pathname);
}

export async function applyUnauthorizedSessionPolicy(
  status: number,
  endpoint: string,
  bearerToken: string | null,
  session: RejectedTokenInvalidator,
  errorCode?: unknown,
): Promise<boolean> {
  if (status !== 401 || !bearerToken || !isAuthenticatedApiEndpoint(endpoint)) return false;
  // A rejected step-up password/code does not reject the authenticated JWT.
  if (errorCode === 'PLATFORM_BINDING_VERIFICATION_FAILED' &&
      /^\/api\/platform\/(?:email-binding|phone-binding)(?:\/|$)/.test(endpoint)) return false;
  await session.invalidateRejectedToken(bearerToken);
  return true;
}
