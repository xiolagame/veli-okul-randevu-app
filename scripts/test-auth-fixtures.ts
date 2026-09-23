import crypto from 'crypto';
import { getDb } from '../server/database/postgres';
import { hashPassword } from '../server/passwords';

const FIXTURE_PHONES = [
  '+905551234567',
  '+905559876543',
  '+905321112233',
  '+905559998877',
  '+905550001122',
];

export function createTestPassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function bootstrapLocalPasswordFixtures(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<string> {
  if (db.engineType !== 'PostgreSQL (Embedded Persistent Engine)') {
    throw new Error('Test password fixtures may only be bootstrapped in local PGlite.');
  }

  const password = createTestPassword();

  for (const phone of FIXTURE_PHONES) {
    const result = await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE phone = $2 RETURNING id;',
      [hashPassword(password), phone]
    );

    if (result.rows.length !== 1) {
      throw new Error(`Test fixture user was not found for phone ${phone}.`);
    }
  }

  return password;
}
