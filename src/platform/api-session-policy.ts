export interface RejectedTokenInvalidator {
  invalidateRejectedToken(token: string): Promise<void>;
}

export function isAuthenticatedApiEndpoint(endpoint: string): boolean {
  return !endpoint.startsWith('/api/auth/')
    && !endpoint.startsWith('/api/public/')
    && !endpoint.includes('/appointments/email-review');
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
