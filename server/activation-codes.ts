import crypto from 'crypto';

const MIN_SECRET_LENGTH = 32;

function getCodeSecret(): string {
  const configured = process.env.AUTH_CODE_SECRET?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!configured || configured.length < MIN_SECRET_LENGTH) {
      throw new Error('KRİTİK HATA (Production Fail-Fast): AUTH_CODE_SECRET tanımlı ve en az 32 karakter olmalıdır.');
    }
    return configured;
  }

  return configured || crypto.randomBytes(32).toString('hex');
}

const codeSecret = getCodeSecret();

export function generateActivationCode(): string {
  return crypto.randomInt(10000, 100000).toString();
}

export function hashActivationCode(code: string): string {
  return crypto
    .createHmac('sha256', codeSecret)
    .update(code.replace(/[^A-Z0-9]/gi, '').toUpperCase())
    .digest('hex');
}
