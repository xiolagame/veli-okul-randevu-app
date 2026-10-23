import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'server/database/supabase_schema.sql'), 'utf8');
const unifiedMigration = fs.readFileSync(
  path.join(process.cwd(), 'server/database/migrations/20261023_unified_admin_whatsapp_purposes.sql'),
  'utf8',
);

async function assertAdminChallengeAccepted(db: PGlite, prefix: string) {
  await db.query(
    `INSERT INTO whatsapp_auth_challenges
     (id,target_phone,target_role,purpose,code_hash,expires_at,resend_available_at)
     VALUES($1,$2,'admin','school_admin_login',$3,NOW()+INTERVAL '5 minutes',NOW())`,
    [`${prefix}-${crypto.randomUUID()}`, '+905551234567', crypto.randomBytes(32).toString('hex')],
  );
  const result = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM whatsapp_auth_challenges WHERE target_role='admin' AND purpose='school_admin_login'",
  );
  assert.equal(result.rows[0].count, 1);
}

async function withTemporaryDatabase(name: string, run: (db: PGlite) => Promise<void>) {
  const directory = path.join(os.tmpdir(), `veli-${name}-${crypto.randomUUID()}`);
  const db = new PGlite(directory);
  try {
    await run(db);
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function run() {
  await withTemporaryDatabase('whatsapp-clean', async (db) => {
    await db.exec(schemaSql);
    await db.exec(unifiedMigration);
    await db.exec(unifiedMigration);
    await assertAdminChallengeAccepted(db, 'clean');
  });

  await withTemporaryDatabase('whatsapp-existing', async (db) => {
    await db.exec(`
      CREATE TABLE whatsapp_auth_challenges (
        id VARCHAR(100) PRIMARY KEY,
        target_phone VARCHAR(20) NOT NULL,
        target_role VARCHAR(20) CHECK (target_role IS NULL OR target_role IN ('parent','teacher','security')),
        purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('login','parent_registration','staff_activation','account_deletion')),
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        resend_available_at TIMESTAMP NOT NULL
      );
    `);
    await db.exec(unifiedMigration);
    await db.exec(unifiedMigration);
    await assertAdminChallengeAccepted(db, 'existing');
  });

  console.log('WhatsApp migrations: clean schema, existing schema and repeated idempotent application PASS.');
}

run().catch((cause) => {
  console.error('WhatsApp migration test FAILED.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
