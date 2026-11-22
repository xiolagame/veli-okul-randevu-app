import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { formatTryAmount } from '../src/utils/tr-currency';

type ResponseResult = { status: number; body: Record<string, any> };

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-platform-pricing-test-secret-at-least-32-chars';
  process.env.AUTH_CODE_SECRET = 'local-platform-pricing-code-secret-at-least-32-chars';

  let checks = 0;
  const check = (condition: unknown, message: string) => { assert(condition, message); checks++; };
  const equal = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks++; };

  // Biçimleme
  equal(formatTryAmount(990000), '9.900 TL', 'whole lira formats Turkish style');
  equal(formatTryAmount(1250000), '12.500 TL', 'thousands separator is a dot');
  equal(formatTryAmount(990050), '9.900,50 TL', 'kurus uses decimal comma');

  // Kaynak kontrolleri
  const section = fs.readFileSync('src/components/PublicRequestSection.tsx', 'utf8');
  check(!/9\.900|9900/.test(section), 'public request form no longer hardcodes the price');
  check(section.includes('loadYearlyLicensePrice') && section.includes('api.createPublicRequest'), 'form loads price and keeps request submission');
  const migration = fs.readFileSync('server/database/migrations/20261122_add_platform_pricing.sql', 'utf8');
  check(migration.includes('ENABLE ROW LEVEL SECURITY') && migration.includes('TO service_role'), 'pricing table is RLS protected for service_role only');
  check(!/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i.test(migration), 'pricing migration is additive');
  const policy = fs.readFileSync('src/platform/api-session-policy.ts', 'utf8');
  check(policy.includes('/api/public/pricing'), 'public pricing endpoint never invalidates sessions');

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `pricing-school-${suffix}`;
  const createdUsers: string[] = [];

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object): Promise<ResponseResult> {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text || '{}') };
  }

  async function fixture(role: 'admin' | 'teacher', label: string) {
    const user = await userRepository.create({
      phone: `+905${crypto.randomInt(100000000, 999999999)}`,
      firstName: label,
      lastName: 'PRICING TEST',
      email: `${label.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@example.test`,
    });
    createdUsers.push(user.id);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const auth = await userRepository.getById(user.id);
    assert(auth);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: auth.authVersion }) };
  }

  const originalRow = await db.query('SELECT amount_minor, revision FROM platform_pricing WHERE plan_code=$1', ['YEARLY_LICENSE']);
  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
      [schoolId, 'Fiyat Test Okulu', `PR${crypto.randomBytes(4).toString('hex')}`.toUpperCase(), 'Ankara', 'Çankaya']);
    const schoolAdmin = await fixture('admin', 'SCHOOLADMIN');
    const platform = await fixture('admin', 'PLATFORM');
    process.env.PLATFORM_ADMIN_USER_IDS = platform.user.id;

    // Herkese açık okuma
    const publicRead = await request('GET', '/public/pricing');
    equal(publicRead.status, 200, 'public pricing is readable without login');
    const yearly = (publicRead.body.plans as any[]).find((plan) => plan.code === 'YEARLY_LICENSE');
    check(yearly && Number.isInteger(yearly.amountMinor) && yearly.amountMinor > 0 && yearly.currency === 'TRY', 'public pricing returns yearly plan in TRY');
    check(!('updated_by_user_id' in yearly) && !('updatedByUserId' in yearly), 'public pricing hides admin identity');

    // Yetkisiz değişiklik
    equal((await request('PATCH', '/platform/pricing/YEARLY_LICENSE', undefined, { amountMinor: 1 })).status, 401, 'anonymous cannot change price');
    equal((await request('PATCH', '/platform/pricing/YEARLY_LICENSE', schoolAdmin.token, { amountMinor: 1100000 })).status, 403, 'school admin cannot change price');
    const unchanged = await db.query('SELECT amount_minor FROM platform_pricing WHERE plan_code=$1', ['YEARLY_LICENSE']);
    equal(Number(unchanged.rows[0].amount_minor), Number(originalRow.rows[0].amount_minor), 'rejected changes leave price intact');

    // Doğrulama
    for (const bad of [0, -5, 12.5, '1000', null, 100_000_001]) {
      equal((await request('PATCH', '/platform/pricing/YEARLY_LICENSE', platform.token, { amountMinor: bad })).status, 400, `invalid amount ${String(bad)} rejected`);
    }
    equal((await request('PATCH', '/platform/pricing/UNKNOWN_PLAN', platform.token, { amountMinor: 100 })).status, 404, 'unknown plan rejected');

    // Yetkili değişiklik
    const changed = await request('PATCH', '/platform/pricing/YEARLY_LICENSE', platform.token, { amountMinor: 1100000 });
    equal(changed.status, 200, 'platform admin changes price');
    equal(changed.body.plan.amountMinor, 1100000, 'response carries new amount');
    equal(changed.body.plan.revision, Number(originalRow.rows[0].revision) + 1, 'revision increments');
    const afterRead = await request('GET', '/public/pricing');
    equal((afterRead.body.plans as any[]).find((plan) => plan.code === 'YEARLY_LICENSE').amountMinor, 1100000, 'public read returns the new price');
    const audit = await db.query(`SELECT audit_scope, details FROM audit_logs WHERE action='platform_pricing.updated' AND actor_user_id=$1`, [platform.user.id]);
    check(audit.rows.length === 1 && audit.rows[0].audit_scope === 'PLATFORM', 'price change is written to platform audit log');

    // Lisans talebi formu bozulmadı
    const requestResult = await request('POST', '/public/requests', undefined, {
      requestToken: crypto.randomUUID(), requestType: 'YEARLY_LICENSE', schoolName: `Price Test Okul ${suffix}`,
      contactName: 'Test Yetkili', email: `price-${crypto.randomBytes(3).toString('hex')}@example.test`,
      phone: '0555 123 45 67', message: 'Fiyat testi', companyWebsite: '',
    });
    check(requestResult.status === 200 || requestResult.status === 201, 'yearly license request still accepted');

    check(checks >= 20, `expected at least 20 checks, received ${checks}`);
    console.log(`Platform pricing ${checks} format, authorization, validation, audit and compatibility checks PASS.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('UPDATE platform_pricing SET amount_minor=$1, revision=$2 WHERE plan_code=$3',
      [originalRow.rows[0].amount_minor, originalRow.rows[0].revision, 'YEARLY_LICENSE']);
    await db.query(`DELETE FROM audit_logs WHERE action='platform_pricing.updated'`);
    await db.query(`DELETE FROM platform_requests WHERE school_name_snapshot LIKE $1`, [`%${suffix}%`]);
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const userId of createdUsers) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause: unknown) => {
  console.error('Platform pricing test FAILED.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
