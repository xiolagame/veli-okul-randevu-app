import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { userRepository, membershipRepository, schoolRepository, schoolLicenseRepository } from './repositories';
import { UserRole, SchoolMembership } from '../src/types';

const configuredSecret = process.env.JWT_SECRET?.trim();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error('KRİTİK HATA (Production Fail-Fast): JWT_SECRET tanımlı ve en az 32 karakter olmalıdır.');
}

const SECRET_KEY = configuredSecret || crypto.randomBytes(32).toString('base64url');

export interface AuthUser {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  isPhoneVerified: boolean;
  authMethod: AuthMethod;
}

export type AuthMethod = 'password' | 'whatsapp_otp' | 'whatsapp_admin' | 'quick_switch' | 'legacy_password';

export interface AuthTokenPayload {
  userId: string;
  phone: string;
  auth_version: number;
  auth_method: AuthMethod;
}

type AuthTokenInput = Omit<AuthTokenPayload, 'auth_method'> & { auth_method?: Exclude<AuthMethod, 'legacy_password'> };

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  membership?: SchoolMembership | { schoolId: string; role: UserRole };
  schoolContext?: { schoolId: string; role: UserRole; source: 'membership' | 'platform'; membership?: SchoolMembership };
  platformTargetSchoolId?: string;
}

export function isPlatformAdmin(userId: string | undefined): boolean {
  return !!userId && (process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean).includes(userId);
}

export function createAccountDeletionSubjectHash(userId: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(`account-deletion:${userId}`).digest('hex');
}

// Token helper using base64url HMAC-SHA256
export function createToken(payload: AuthTokenInput, expiresInSeconds = 86400): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, auth_method: payload.auth_method || 'password', exp })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(`${header}.${body}`)
      .digest('base64url');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    if (
      typeof payload?.userId !== 'string' ||
      typeof payload.phone !== 'string' ||
      !Number.isInteger(payload.auth_version) ||
      (payload.auth_method !== undefined && !['password', 'whatsapp_otp', 'whatsapp_admin', 'quick_switch'].includes(payload.auth_method))
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      phone: payload.phone,
      auth_version: payload.auth_version,
      auth_method: payload.auth_method || 'legacy_password',
    };
  } catch (err) {
    return null;
  }
}

// Global Auth Middleware
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Yetkilendirme gerekli (Token bulunamadı)' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum anahtarı' });
    }

    const user = await userRepository.getById(payload.userId);
    if (!user || user.authVersion !== payload.auth_version) {
      return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum anahtarı' });
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      isPhoneVerified: !!user.isPhoneVerified,
      authMethod: payload.auth_method,
    };

    next();
  } catch (err) {
    console.error('[authMiddleware Error]:', err);
    return res.status(500).json({ error: 'Yetkilendirme sırasında sunucu hatası oluştu' });
  }
}

// Multi-Tenant Isolation Guard
// Enforces that the authenticated user MUST have an active SchoolMembership in the requested schoolId
export function tenantGuard(allowedRoles?: UserRole[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Kullanıcı doğrulanmadı' });
      }

      // Determine target schoolId: route param takes precedence when present
      const routeSchoolId = req.params.schoolId;
      const headerSchoolId = req.headers['x-school-id'] as string;

      if (routeSchoolId && headerSchoolId && routeSchoolId !== headerSchoolId) {
        return res.status(400).json({
          error: 'Okul bağlamı uyuşmazlığı: URL parametresi ile X-School-Id başlığı eşleşmiyor (Cross-Tenant Koruma).',
        });
      }

      const schoolId = routeSchoolId || headerSchoolId;

      if (!schoolId) {
        return res.status(400).json({ error: 'Okul bağlamı (X-School-Id) eksik veya geçersiz' });
      }

      const platformContext = req.platformTargetSchoolId === schoolId && canUsePlatformAuthority(req.user);
      let membership: SchoolMembership | null = null;
      if (!platformContext) {
        if (req.user.authMethod === 'whatsapp_otp' || req.user.authMethod === 'whatsapp_admin') {
          const eligibleRoles: UserRole[] = req.user.authMethod === 'whatsapp_admin' ? ['admin'] : ['parent', 'teacher', 'security'];
          const memberships = await membershipRepository.getMembershipsByUserId(req.user.id);
          membership = memberships.find((entry) =>
            entry.schoolId === schoolId && eligibleRoles.includes(entry.role) && (!allowedRoles?.length || allowedRoles.includes(entry.role))) || null;
          if (membership && (!await schoolRepository.getById(schoolId) || !await schoolLicenseRepository.isAccessAllowed(schoolId))) membership = null;
        } else {
          membership = await requireSchoolMembership(req.user.id, schoolId);
        }
      }

      if (!membership && !platformContext) {
        return res.status(403).json({
          error: 'Erişim Reddedildi: Bu okulda aktif üyeliğiniz bulunmamaktadır (Tenant İzolasyon Koruması).',
        });
      }

      const role = platformContext ? 'admin' : membership!.role;
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
        return res.status(403).json({
          error: `Erişim Reddedildi: Bu işlem için yetkiniz (${role}) yetersizdir. Gerekli rol: ${allowedRoles.join(', ')}`,
        });
      }

      req.membership = membership || { schoolId, role: 'admin' };
      req.schoolContext = platformContext
        ? { schoolId, role: 'admin', source: 'platform' }
        : { schoolId, role: membership!.role, source: 'membership', membership: membership! };
      next();
    } catch (err) {
      console.error('[tenantGuard Error]:', err);
      return res.status(500).json({ error: 'Yetkilendirme kontrolü sırasında sunucu hatası oluştu' });
    }
  };
}

export function canUsePlatformAuthority(user: AuthUser | undefined): boolean {
  return !!user && user.authMethod !== 'whatsapp_otp' && user.authMethod !== 'whatsapp_admin' && isPlatformAdmin(user.id);
}

// ==============================================================================
// FAZ 15: CENTRALIZED TENANT AUTHORIZATION HELPERS
// ==============================================================================

/**
 * Returns the securely verified schoolId from the authenticated request membership.
 * NEVER trusts blind headers or unverified client inputs.
 */
export function getAuthorizedSchool(req: AuthenticatedRequest): string {
  if (!req.schoolContext || !req.schoolContext.schoolId) {
    throw new Error('Erişim Reddedildi: İstek için doğrulanmış okul üyeliği (tenant context) bulunamadı.');
  }
  return req.schoolContext.schoolId;
}

/**
 * Ensures user has an active membership in the school.
 */
export async function requireSchoolMembership(userId: string, schoolId: string): Promise<SchoolMembership | null> {
  if (!await schoolRepository.getById(schoolId)) return null;
  if (!await schoolLicenseRepository.isAccessAllowed(schoolId)) return null;
  return membershipRepository.getActiveMembership(userId, schoolId);
}

/**
 * Enforces specific role requirement inside a school.
 */
export async function requireSchoolRole(userId: string, schoolId: string, allowedRoles: UserRole[]): Promise<SchoolMembership> {
  const mem = await requireSchoolMembership(userId, schoolId);
  if (!mem) {
    throw new Error('Erişim Reddedildi: Bu okulda aktif üyeliğiniz bulunmamaktadır.');
  }
  if (!allowedRoles.includes(mem.role)) {
    throw new Error(`Erişim Reddedildi: Bu işlem için ${allowedRoles.join(', ')} rolü gereklidir. Mevcut rolünüz: ${mem.role}`);
  }
  return mem;
}

/**
 * Asserts that a target resource belongs strictly to the requested school context.
 * Hard barrier against cross-tenant IDOR attacks.
 */
export function assertResourceBelongsToSchool(resourceSchoolId: string, expectedSchoolId: string): void {
  if (!resourceSchoolId || resourceSchoolId !== expectedSchoolId) {
    throw new Error('Güvenlik İhlali: İstenen kaynak aktif okul bağlamına ait değildir (Cross-Tenant IDOR engellendi).');
  }
}

// In-memory rate limiting map for OTP / Enumeration protection
const rateLimitMap: { [key: string]: { count: number; firstAttempt: number } } = {};

export function checkRateLimit(key: string, maxAttempts = 5, windowSeconds = 60): boolean {
  const now = Date.now();
  const record = rateLimitMap[key];
  if (!record) {
    rateLimitMap[key] = { count: 1, firstAttempt: now };
    return true;
  }

  if (now - record.firstAttempt > windowSeconds * 1000) {
    rateLimitMap[key] = { count: 1, firstAttempt: now };
    return true;
  }

  record.count += 1;
  return record.count <= maxAttempts;
}
