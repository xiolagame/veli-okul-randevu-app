import crypto from 'crypto';

const HASH_ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `Şifre ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} karakter arasında olmalıdır.`;
  }
  return null;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedHash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${HASH_ALGORITHM}$${salt}$${derivedHash}`;
}

export function verifyPassword(password: string, passwordHash: string | null | undefined): boolean {
  if (!passwordHash || !password) return false;

  const [algorithm, salt, expectedHash] = passwordHash.split('$');
  if (algorithm !== HASH_ALGORITHM || !salt || !expectedHash) return false;

  try {
    const derivedHash = crypto.scryptSync(password, salt, KEY_LENGTH);
    const storedHash = Buffer.from(expectedHash, 'hex');

    return storedHash.length === derivedHash.length && crypto.timingSafeEqual(storedHash, derivedHash);
  } catch {
    return false;
  }
}
