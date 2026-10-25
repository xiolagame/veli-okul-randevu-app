import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import pg from 'pg';

// Exercise the real pg.Pool queue with an in-memory transport. No DB/network access.
const bundled = await build({
  entryPoints: ['server/database/postgres.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
});
const require = createRequire(import.meta.url);
function fixture(port = 5432, environment = {}) {
  const state = { pools: [], clients: [], peak: 0, active: 0, queries: [], logs: [],
    failConnect: false, failQuery: '', failRollback: false, gate: null, entered: null };
  class Client extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(callback) {
      queueMicrotask(() => {
        if (state.failConnect) return callback(new Error('EMAXCONNSESSION synthetic-sensitive-detail'));
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        state.clients.push(this);
        callback();
      });
    }
    query(sql, values, callback) {
      if (typeof values === 'function') callback = values;
      const operation = (async () => {
        assert.equal(typeof sql, 'string', 'unnamed parameterized queries only');
        state.queries.push(sql);
        if (sql === 'HOLD') { state.entered(); await state.gate; }
        if (sql === state.failQuery || (sql === 'ROLLBACK' && state.failRollback)) throw new Error('synthetic-query-error');
        return { rows: [{ ping: 1 }], rowCount: 1 };
      })();
      if (callback) { operation.then((result) => callback(null, result), callback); return; }
      return operation;
    }
    end(callback) {
      if (!this._ending) { this._ending = true; state.active -= 1; }
      queueMicrotask(() => { this.emit('end'); callback?.(); });
    }
    ref() {}
    unref() {}
  }
  class Pool extends pg.Pool {
    constructor(options) { super({ ...options, Client }); state.pools.push(this); }
  }
  const output = { exports: {} };
  const context = {
    module: output, exports: output.exports,
    require: (name) => name === 'pg' ? { Pool } : require(name),
    process: { env: { NODE_ENV: 'production',
      DATABASE_URL: `postgresql://synthetic:synthetic@pooler.invalid:${port}/postgres`,
      SUPABASE_DB_CA_B64: Buffer.from('-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----').toString('base64'), ...environment },
      cwd: () => process.cwd() },
    console: Object.fromEntries(['log', 'warn', 'error'].map((key) => [key, (...args) => state.logs.push(args.join(' '))])),
    Buffer, URL, setTimeout, clearTimeout,
  };
  vm.runInNewContext(bundled.outputFiles[0].text, context);
  return { api: output.exports, state };
}

for (const port of [5432, 6543]) {
  const { api, state } = fixture(port);
  await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? api.initDatabase() : api.getDb()));
  assert.equal(state.pools.length, 1, 'mixed cold-start callers must share one initialization');
  const pool = state.pools[0];
  assert.equal(pool.options.max, 1);
  assert.equal(pool.options.idleTimeoutMillis, 5000);
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  assert.equal(pool.options.ssl.rejectUnauthorized, true);
  assert(pool.options.ssl.ca.includes('BEGIN CERTIFICATE'));
  assert.equal(state.queries.length, 1, 'one startup probe');
  const db = await api.getDb();
  let release;
  state.gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { state.entered = resolve; });
  const held = db.query('HOLD');
  await entered;
  const queued = Array.from({ length: 12 }, () => db.query('SELECT 1'));
  assert.equal(pool.waitingCount, 12, 'concurrency queues instead of opening more sessions');
  release();
  await Promise.all([held, ...queued]);
  assert.equal(state.peak, 1);
  state.queries.length = 0;
  await db.transaction(async (tx) => { await tx.query('UPDATE synthetic SET value=$1', [1]); });
  assert.deepEqual(state.queries, ['BEGIN', 'UPDATE synthetic SET value=$1', 'COMMIT']);
  state.failQuery = 'FAIL';
  state.failRollback = true;
  await assert.rejects(db.transaction((tx) => tx.query('FAIL')), /synthetic-query-error/);
  assert.equal(pool.totalCount, 0, 'broken rollback connection must be evicted');
  state.failQuery = '';
  state.failRollback = false;
  await db.query('SELECT 1');
  const idle = state.clients.at(-1);
  idle.emit('error', new Error('synthetic-sensitive-detail'));
  assert.equal(pool.totalCount, 0, 'idle connection error handled without process crash');
  await db.query('SELECT 1');
  assert(!state.logs.join(' ').includes('synthetic-sensitive-detail'));
  await api.closeDatabase();
  assert.equal(state.active, 0);
}

const failed = fixture();
failed.state.failConnect = true;
const coldStarts = await Promise.allSettled(Array.from({ length: 10 }, () => failed.api.getDb()));
assert(coldStarts.every((result) => result.status === 'rejected'));
assert.equal(failed.state.pools.length, 1);
assert.equal(failed.state.pools[0].ended, true);
assert(!failed.state.logs.join(' ').includes('synthetic-sensitive-detail'));
failed.state.failConnect = false;
await failed.api.getDb();
assert.equal(failed.state.pools.length, 2, 'failed initialization can retry without leaked pools');
await failed.api.closeDatabase();
for (const certificate of ['', Buffer.from('invalid certificate').toString('base64')]) {
  const invalidTls = fixture(6543, { SUPABASE_DB_CA_B64: certificate });
  await assert.rejects(invalidTls.api.getDb(), /PostgreSQL connection unavailable/);
  assert.equal(invalidTls.state.pools.length, 0, 'missing/invalid CA must fail before opening a connection');
}
console.log('PostgreSQL pool: single cold-start initialization, bounded concurrency, transaction affinity, failed-connect retry, broken-client eviction and TLS PASS.');
