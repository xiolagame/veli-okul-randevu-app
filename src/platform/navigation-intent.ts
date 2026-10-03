export type NavigationIntent =
  | { type: 'APPOINTMENT'; resourceId: string }
  | { type: 'SUPPORT_REQUEST'; resourceId: string }
  | { type: 'PLATFORM_REQUEST'; resourceId: string }
  | { type: 'NOTIFICATIONS' };

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRAVERSAL_PATTERN = /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i;

function defaultOrigin(): string {
  return typeof window === 'undefined' ? 'https://velirandevu.com' : window.location.origin;
}

export function parseNavigationIntent(input: string, allowedOrigin = defaultOrigin()): NavigationIntent | null {
  const candidate = input.trim();
  if (!candidate || TRAVERSAL_PATTERN.test(candidate)) return null;

  let url: URL;
  try {
    if (!candidate.startsWith('/') && !/^https?:\/\//i.test(candidate)) return null;
    url = new URL(candidate, allowedOrigin);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(allowedOrigin).origin) return null;
  if (url.username || url.password || url.search || url.hash) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\');
    } catch {
      return true;
    }
  })) return null;

  if (segments.length === 2 && segments[0] === 'app' && segments[1] === 'notifications') {
    return { type: 'NOTIFICATIONS' };
  }

  if (segments.length !== 3 || segments[0] !== 'app' || !RESOURCE_ID_PATTERN.test(segments[2])) return null;
  if (segments[1] === 'appointments') return { type: 'APPOINTMENT', resourceId: segments[2] };
  if (segments[1] === 'support') return { type: 'SUPPORT_REQUEST', resourceId: segments[2] };
  if (segments[1] === 'platform-requests') return { type: 'PLATFORM_REQUEST', resourceId: segments[2] };
  return null;
}

export class PendingNavigationIntentStore {
  private pendingIntent: NavigationIntent | null = null;

  set(intent: NavigationIntent): void {
    this.pendingIntent = intent;
  }

  peek(): NavigationIntent | null {
    return this.pendingIntent;
  }

  take(): NavigationIntent | null {
    const intent = this.pendingIntent;
    this.pendingIntent = null;
    return intent;
  }

  clear(): void {
    this.pendingIntent = null;
  }
}

export const pendingNavigationIntent = new PendingNavigationIntentStore();
