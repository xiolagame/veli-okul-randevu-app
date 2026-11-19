import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// In-memory PostgreSQL only. Never imports the application DB connector.
const migration = fs.readFileSync(new URL('../server/database/migrations/20261026_add_roster_import_jobs.sql', import.meta.url), 'utf8');
const oldTables = migration.split('-- Also harden an existing draft schema.')[0];
const setup = `CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
  GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
  CREATE TABLE schools(id text PRIMARY KEY); CREATE TABLE users(id text PRIMARY KEY);
  INSERT INTO schools VALUES('synthetic-school'); INSERT INTO users VALUES('synthetic-actor');`;
const hash = 'a'.repeat(64);
const seed = `INSERT INTO roster_import_jobs(id,school_id,actor_user_id,manifest_hash,total_rows,created_at,updated_at)
 VALUES('running','synthetic-school','synthetic-actor','${hash}',100,'2000-01-01','2000-01-01');
 INSERT INTO roster_import_jobs(id,school_id,actor_user_id,manifest_hash,chain_hash,total_rows,processed,added,next_batch,status,created_at,updated_at)
 VALUES('completed','synthetic-school','synthetic-actor','${hash}','${hash}',100,100,100,1,'COMPLETED','2000-01-01','2000-01-01');
 INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)VALUES('completed',0,'${hash}','{"added":100,"errors":[]}');`;
async function rejected(db: PGlite, sql: string, code: string) {
  await assert.rejects(() => db.query(sql), error => !!error && typeof error === 'object' && 'code' in error && error.code === code);
}
async function verify(db: PGlite) {
  const checks = await db.query<{ conname: string; convalidated: boolean }>(`SELECT conname,convalidated FROM pg_constraint
    WHERE conrelid IN ('roster_import_jobs'::regclass,'roster_import_batches'::regclass)`);
  for (const name of ['processed_nonnegative','added_nonnegative','skipped_nonnegative','invalid_nonnegative','chain_hash_format','payload_hash_format']) {
    assert(checks.rows.some(c => c.conname.endsWith(name) && c.convalidated), name);
  }
  assert.equal((await db.query('SELECT * FROM roster_import_jobs')).rows.length, 2, 'old running/completed jobs must not expire');
  assert.equal((await db.query('SELECT * FROM roster_import_batches')).rows.length, 1, 'replay/error reports retained');
  assert.deepEqual((await db.query<{ result: object }>("SELECT result FROM roster_import_batches WHERE job_id='completed'")).rows[0].result, { added:100, errors:[] });
  for (const values of ['processed=-1,added=-1','added=-1,skipped=1','skipped=-1,added=1','invalid=-1,added=1']) {
    await rejected(db, `UPDATE roster_import_jobs SET ${values} WHERE id='running'`, '23514');
  }
  for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64), ' '+hash, hash+'\n']) {
    await rejected(db, `INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)VALUES('running',0,'${bad}','{}')`, '23514');
    if (bad) await rejected(db, `UPDATE roster_import_jobs SET chain_hash='${bad}' WHERE id='running'`, '23514');
  }
  await db.query(`UPDATE roster_import_jobs SET chain_hash='${hash}' WHERE id='running'`);
  await db.query("UPDATE roster_import_jobs SET chain_hash='' WHERE id='running'");
  for (const table of ['roster_import_jobs','roster_import_batches']) {
    assert.equal((await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass`)).rows[0].relrowsecurity, true);
    const policies = await db.query<{ roles: string[]; cmd: string }>(`SELECT roles,cmd FROM pg_policies WHERE schemaname='public' AND tablename='${table}'`);
    assert.equal(policies.rows.length, 1); assert.deepEqual(policies.rows[0].roles, ['service_role']); assert.equal(policies.rows[0].cmd, 'ALL');
    for (const role of ['anon','authenticated']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal((await db.query<{ allowed: boolean }>(`SELECT has_table_privilege('${role}','public.${table}','${privilege}') AS allowed`)).rows[0].allowed, false, role + ' ' + privilege);
      }
      for (const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) {
        assert.equal((await db.query<{ allowed: boolean }>(`SELECT has_any_column_privilege('${role}','public.${table}','${privilege}') AS allowed`)).rows[0].allowed, false, 'column grant ' + role);
      }
      await db.exec(`SET ROLE ${role}`);
      try {
        await rejected(db, `SELECT * FROM ${table}`, '42501');
        await rejected(db, `DELETE FROM ${table} WHERE FALSE`, '42501');
        await rejected(db, `UPDATE ${table} SET ${table === 'roster_import_jobs' ? "status='RUNNING'" : "result='{}'"} WHERE FALSE`, '42501');
      } finally { await db.exec('RESET ROLE'); }
    }
    for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
      assert.equal((await db.query<{ allowed: boolean }>(`SELECT has_table_privilege('service_role','public.${table}','${privilege}') AS allowed`)).rows[0].allowed, true);
    }
    for (const privilege of ['TRUNCATE','REFERENCES','TRIGGER']) {
      assert.equal((await db.query<{ allowed: boolean }>(`SELECT has_table_privilege('service_role','public.${table}','${privilege}') AS allowed`)).rows[0].allowed, false);
    }
  }
  // A non-BYPASSRLS service_role must work through the explicit policy.
  await db.exec('SET ROLE service_role');
  try {
    assert.equal((await db.query('SELECT id FROM roster_import_jobs')).rows.length, 2);
    await db.query(`INSERT INTO roster_import_jobs(id,school_id,actor_user_id,manifest_hash,total_rows)
      VALUES('service-job','synthetic-school','synthetic-actor','${hash}',100)`);
    await db.query("UPDATE roster_import_jobs SET updated_at=NOW() WHERE id='service-job'");
    await db.query("DELETE FROM roster_import_jobs WHERE id='service-job'");
    await db.query(`INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)VALUES('running',0,'${hash}','{}')`);
    await db.query(`UPDATE roster_import_batches SET result='{"added":0}' WHERE job_id='running'`);
    await db.query("DELETE FROM roster_import_batches WHERE job_id='running'");
  } finally { await db.exec('RESET ROLE'); }
  // RLS must still deny browser reads even if someone later grants SELECT.
  await db.exec('GRANT SELECT ON roster_import_jobs,roster_import_batches TO anon,authenticated');
  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      assert.equal((await db.query('SELECT * FROM roster_import_jobs')).rows.length, 0);
      assert.equal((await db.query('SELECT * FROM roster_import_batches')).rows.length, 0);
    } finally { await db.exec('RESET ROLE'); }
  }
  await db.exec(migration); // Reapplying removes the accidental grants too.
}
for (const mode of ['clean','existing'] as const) {
  const db = new PGlite();
  try {
    await db.exec(setup);
    if (mode === 'clean') {
      await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
      await db.exec(migration); await db.exec(seed);
    } else {
      await db.exec(oldTables); await db.exec(seed);
      await db.exec('GRANT ALL ON roster_import_jobs,roster_import_batches TO PUBLIC,anon,authenticated,service_role; GRANT SELECT(id),UPDATE(status) ON roster_import_jobs TO PUBLIC,anon,authenticated; GRANT SELECT(payload_hash) ON roster_import_batches TO authenticated');
      await db.exec(migration);
    }
    await db.exec(migration); await verify(db);
    console.log(`Roster migration ${mode} schema: constraints, hashes, default/column ACL revocation, RLS, service_role, retained resume/reports and repeated application PASS.`);
  } finally { await db.close(); }
}
const invalid = new PGlite();
try {
  await invalid.exec(setup); await invalid.exec(oldTables); await invalid.exec(seed);
  await invalid.query("UPDATE roster_import_jobs SET added=-1,skipped=1 WHERE id='running'");
  await invalid.exec('BEGIN');
  await assert.rejects(() => invalid.exec(migration), error => !!error && typeof error === 'object' && 'code' in error && error.code === '23514');
  await invalid.exec('ROLLBACK');
  assert.equal((await invalid.query<{ added: number }>("SELECT added::int AS added FROM roster_import_jobs WHERE id='running'")).rows[0].added, -1, 'invalid existing data must not be silently rewritten');
  console.log('Invalid legacy counters reject migration atomically without data repair PASS.');
} finally { await invalid.close(); }

const inherited = new PGlite();
try {
  await inherited.exec(setup); await inherited.exec(oldTables); await inherited.exec(seed);
  await inherited.exec('GRANT service_role TO authenticated; BEGIN');
  await assert.rejects(() => inherited.exec(migration), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'P0001');
  await inherited.exec('ROLLBACK');
  assert.equal((await inherited.query('SELECT * FROM roster_import_jobs')).rows.length, 2);
  console.log('Unexpected inherited browser-role privileges fail migration closed without rewriting roles or data PASS.');
} finally { await inherited.close(); }

// The production connector uses DATABASE_URL, not SET ROLE service_role.
// Exercise FORCE on a disposable schema before deciding whether it is compatible.
const forced = new PGlite();
try {
  await forced.exec(setup); await forced.exec(migration); await forced.exec(seed);
  await forced.exec(`CREATE ROLE backend_owner NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE backend_bypass NOSUPERUSER BYPASSRLS;
    CREATE ROLE backend_reader NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO backend_owner,backend_bypass,backend_reader;
    ALTER TABLE roster_import_jobs OWNER TO backend_owner;
    ALTER TABLE roster_import_batches OWNER TO backend_owner;
    GRANT SELECT,INSERT,UPDATE,DELETE ON roster_import_jobs,roster_import_batches TO backend_bypass,backend_reader;`);
  async function readCounts() {
    return [(await forced.query('SELECT id FROM roster_import_jobs FOR UPDATE')).rows.length,
      (await forced.query('SELECT job_id FROM roster_import_batches FOR UPDATE')).rows.length];
  }
  async function writeAndRemove() {
    await forced.query(`INSERT INTO roster_import_jobs(id,school_id,actor_user_id,manifest_hash,total_rows)
      VALUES('role-write','synthetic-school','synthetic-actor','${hash}',100)`);
    assert.equal((await forced.query("UPDATE roster_import_jobs SET updated_at=NOW() WHERE id='role-write' RETURNING id")).rows.length, 1);
    await forced.query(`INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)VALUES('role-write',0,'${hash}','{}')`);
    assert.equal((await forced.query("UPDATE roster_import_batches SET result='{}' WHERE job_id='role-write' RETURNING job_id")).rows.length, 1);
    await forced.query("DELETE FROM roster_import_jobs WHERE id='role-write'");
    assert.equal((await forced.query("SELECT job_id FROM roster_import_batches WHERE job_id='role-write'")).rows.length, 0, 'FK cascade must remain compatible');
  }
  await forced.exec('SET ROLE backend_owner');
  try { assert.deepEqual(await readCounts(), [2,1]); await writeAndRemove(); }
  finally { await forced.exec('RESET ROLE'); }

  await forced.exec(`ALTER TABLE roster_import_jobs FORCE ROW LEVEL SECURITY;
    ALTER TABLE roster_import_batches FORCE ROW LEVEL SECURITY;`);
  const flags = await forced.query<{ relforcerowsecurity: boolean }>(`SELECT relforcerowsecurity FROM pg_class
    WHERE oid IN ('roster_import_jobs'::regclass,'roster_import_batches'::regclass)`);
  assert(flags.rows.every(row => row.relforcerowsecurity));
  await forced.exec('SET ROLE backend_owner');
  try {
    assert.deepEqual(await readCounts(), [0,0], 'FORCE hides jobs from an owner without an applicable policy');
    await rejected(forced, `INSERT INTO roster_import_jobs(id,school_id,manifest_hash,total_rows)
      VALUES('blocked','synthetic-school','${hash}',100)`, '42501');
    await rejected(forced, `INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)
      VALUES('running',0,'${hash}','{}')`, '42501');
    assert.equal((await forced.query("UPDATE roster_import_jobs SET updated_at=NOW() WHERE id='running' RETURNING id")).rows.length, 0);
    assert.equal((await forced.query("DELETE FROM roster_import_batches WHERE job_id='completed' RETURNING job_id")).rows.length, 0);
  } finally { await forced.exec('RESET ROLE'); }
  for (const role of ['service_role','backend_bypass']) {
    await forced.exec(`SET ROLE ${role}`);
    try { assert.deepEqual(await readCounts(), [2,1]); await writeAndRemove(); }
    finally { await forced.exec('RESET ROLE'); }
  }
  // A role with table privileges but no owner/bypass/policy remains denied.
  await forced.exec('SET ROLE backend_reader');
  try { assert.deepEqual(await readCounts(), [0,0]); }
  finally { await forced.exec('RESET ROLE'); }
  assert.deepEqual(await readCounts(), [2,1], 'superuser still bypasses FORCE; real production attributes must not be assumed');

  // Browser ACLs stay closed under FORCE, and inherited ownership is rejected.
  for (const role of ['anon','authenticated']) {
    await forced.exec(`SET ROLE ${role}`);
    try {
      await rejected(forced, 'SELECT * FROM roster_import_jobs', '42501');
      await rejected(forced, 'SELECT * FROM roster_import_batches', '42501');
    } finally { await forced.exec('RESET ROLE'); }
  }
  await forced.exec('GRANT backend_owner TO authenticated; BEGIN');
  await assert.rejects(() => forced.exec(migration), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'P0001');
  await forced.exec('ROLLBACK');
  assert.deepEqual(await readCounts(), [2,1]);
  console.log('FORCE RLS matrix PASS: unprivileged owner is blocked; policy-bound service_role, BYPASSRLS and superuser work; browser direct/inherited-owner access rejected; existing rows preserved.');
} finally { await forced.close(); }
