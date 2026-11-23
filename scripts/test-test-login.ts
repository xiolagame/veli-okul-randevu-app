import assert from 'node:assert/strict';
import { getTestLoginCode } from '../server/test-login';

const keys = ['TEST_LOGIN_CODE', 'TEST_LOGIN_PHONES', 'TEST_LOGIN_EXPIRES'] as const;
const reset = () => keys.forEach((key) => delete process.env[key]);
const now = new Date('2026-11-24T10:00:00Z');

reset();
assert.equal(getTestLoginCode('05000001001', now), null, 'ayar yokken kapalı olmalı');

Object.assign(process.env, { TEST_LOGIN_CODE: '123456', TEST_LOGIN_PHONES: '0500 000 10 01, +905000001002', TEST_LOGIN_EXPIRES: '2026-12-01T00:00:00Z' });
assert.equal(getTestLoginCode('05000001001', now), '123456');
assert.equal(getTestLoginCode('+90 500 000 10 02', now), '123456');
assert.equal(getTestLoginCode('05000001003', now), null, 'listede olmayan numara kabul edilmemeli');
assert.equal(getTestLoginCode('abc', now), null);
assert.equal(getTestLoginCode('05000001001', new Date('2026-12-01T00:00:00Z')), null, 'süre dolunca kapanmalı');

process.env.TEST_LOGIN_CODE = '12345';
assert.equal(getTestLoginCode('05000001001', now), null, '6 haneli olmayan kod geçersiz');
process.env.TEST_LOGIN_CODE = '123456';
process.env.TEST_LOGIN_EXPIRES = 'bozuk';
assert.equal(getTestLoginCode('05000001001', now), null, 'bozuk bitiş tarihi kapalı sayılmalı');

reset();
console.log('Test girişi kuralları PASS');
