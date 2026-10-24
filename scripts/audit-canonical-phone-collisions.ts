import { Pool } from 'pg';
import { getPostgresConnectionOptions } from '../server/database/tls';
import { auditCanonicalPhoneCollisions } from '../server/phone-identity-audit';

async function run() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || process.env.PHONE_COLLISION_AUDIT_READONLY_CONFIRMED?.trim().toLowerCase() !== 'true') {
    throw new Error('Read-only audit confirmation and database connection are required.');
  }
  const pool = new Pool({
    ...getPostgresConnectionOptions(databaseUrl, true),
    max: 1,
    connectionTimeoutMillis: 10000,
    application_name: 'veli-readonly-phone-audit',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const result = await auditCanonicalPhoneCollisions({
      query: async <T>(sql: string, params?: any[]) => {
        const response = await client.query(sql, params);
        return { rows: response.rows as T[], rowCount: response.rowCount ?? response.rows.length };
      },
    });
    await client.query('ROLLBACK');
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

run()
  .catch(() => {
    console.error('Canonical phone collision audit failed. No phone number or user identity was logged.');
    process.exitCode = 1;
  });
