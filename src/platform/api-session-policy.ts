export interface RejectedTokenInvalidator {
  invalidateRejectedToken(token: string): Promise<void>;
}

export function isAuthenticatedApiEndpoint(endpoint: string): boolean {
  const pathname = endpoint.split(/[?#]/, 1)[0];
  const publicEndpoints = new Set(['/api/public/school-context', '/api/public/requests']);
  return !pathname.startsWith('/api/auth/')
    && !publicEndpoints.has(pathname);
}

export async function applyUnauthorizedSessionPolicy(
  status: number,
  endpoint: string,
  bearerToken: string | null,
  session: RejectedTokenInvalidator,
): Promise<boolean> {
  if (status !== 401 || !bearerToken || !isAuthenticatedApiEndpoint(endpoint)) return false;
  await session.invalidateRejectedToken(bearerToken);
  return true;
}
