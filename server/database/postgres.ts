// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: UNIFIED POSTGRESQL DATA ENGINE
// Supports:
// 1. Production: Remote Supabase PostgreSQL / Cloud SQL via pg.Pool (DATABASE_URL)
// 2. Development / Testing: Embedded Persistent PostgreSQL via PGlite (WASM)
// 3. Strict Fail-Fast in Production if DATABASE_URL is missing (No JSON fallback)
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

export interface TransactionClient {
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
}

let pgPool: Pool | null = null;
let pgliteInstance: PGlite | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

const SCHEMA_PATH = path.join(process.cwd(), 'server', 'database', 'supabase_schema.sql');
const SEED_PATH = path.join(process.cwd(), 'server', 'database', 'seed_supabase_migration.sql');
const DATA_DIR = path.join(process.cwd(), 'server', 'data', 'postgres_db');

export async function getDb(): Promise<{
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
  transaction: <T>(fn: (tx: TransactionClient) => Promise<T>) => Promise<T>;
  engineType: string;
}> {
  if (!isInitialized) {
    if (!initPromise) {
      initPromise = initDatabase().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    await initPromise;
  }

  if (pgPool) {
    return {
      engineType: 'Supabase PostgreSQL (Remote Pool)',
      query: async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
        const res = await pgPool!.query(sql, params);
        return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
      },
      transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
        const client: PoolClient = await pgPool!.connect();
        try {
          await client.query('BEGIN');
          const tx: TransactionClient = {
            query: async <R = any>(qSql: string, qParams?: any[]) => {
              const r = await client.query(qSql, qParams);
              return { rows: r.rows as R[], rowCount: r.rowCount ?? r.rows.length };
            },
          };
          const result = await fn(tx);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }

  if (pgliteInstance) {
    return {
      engineType: 'PostgreSQL (Embedded Persistent Engine)',
      query: async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
        const res = await pgliteInstance!.query<T>(sql, params);
        return { rows: res.rows, rowCount: (res as any).affectedRows ?? res.rows.length };
      },
      transaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
        return pgliteInstance!.transaction(async (tx) => {
          const txClient: TransactionClient = {
            query: async <R = any>(qSql: string, qParams?: any[]) => {
              const r = await tx.query<R>(qSql, qParams);
              return { rows: r.rows, rowCount: (r as any).affectedRows ?? r.rows.length };
            },
          };
          return fn(txClient);
        });
      },
    };
  }

  throw new Error('PostgreSQL engine is not initialized');
}

export async function initDatabase(): Promise<void> {
  // Serverless / Warm Invocation Reuse: If pool or instance is already alive and initialized, reuse safely
  if (isInitialized && (pgPool || pgliteInstance)) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const databaseUrl = process.env.DATABASE_URL;

  console.log('[PostgreSQL Engine] Initializing database layer...');

  const isPlaceholderPassword = Boolean(
    databaseUrl && (
      databaseUrl.includes('[YOUR-PASSWORD]') ||
      databaseUrl.includes('%5BYOUR-PASSWORD%5D')
    )
  );

  if (isProduction) {
    if (!databaseUrl) {
      throw new Error(
        'KRİTİK HATA (Production Fail-Fast): NODE_ENV=production modunda DATABASE_URL ortam değişkeni zorunludur! PGlite / Embedded veritabanı veya store.json fallback kesinlikle yasaktır.'
      );
    }

    if (isPlaceholderPassword) {
      throw new Error(
        'KRİTİK HATA (Production Fail-Fast): DATABASE_URL ortam değişkeninde "[YOUR-PASSWORD]" yer tutucusu tespit edildi! Canlı Supabase PostgreSQL şifrenizi Secrets panelinde tanımlamalısınız. PGlite veya store.json fallback kesinlikle yasaktır.'
      );
    }

    console.log('[PostgreSQL Engine] Connecting to remote PostgreSQL cluster via connection pool...');
    try {
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // Test connection
      const client = await pgPool.connect();
      try {
        const res = await client.query('SELECT NOW() as now, current_database() as db;');
        console.log(`[PostgreSQL Engine] Connected successfully to remote database: ${res.rows[0].db} (${res.rows[0].now})`);
      } finally {
        client.release();
      }

      isInitialized = true;
      return;
    } catch (connErr: any) {
      console.error('[PostgreSQL Engine Fatal] Remote PostgreSQL connection failed:', connErr.message);
      // Clean pool reference on failure
      if (pgPool) {
        try {
          await pgPool.end();
        } catch (_) {}
        pgPool = null;
      }
      // In production, or whenever DATABASE_URL was provided, connection failure MUST fail-fast!
      // Strictly NO fallback to PGlite or in-memory/JSON stores.
      throw new Error(`KRİTİK HATA (PostgreSQL Fail-Fast): Remote PostgreSQL veritabanına bağlanılamadı! Sebep: ${connErr.message}`);
    }
  }

  // Development & Test ONLY: Use persistent PGlite PostgreSQL instance
  if (databaseUrl && !isPlaceholderPassword) {
    console.log('[PostgreSQL Engine] Connecting to remote PostgreSQL cluster via connection pool (development)...');
    try {
      pgPool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      const client = await pgPool.connect();
      try {
        const res = await client.query('SELECT NOW() as now, current_database() as db;');
        console.log(`[PostgreSQL Engine] Connected successfully to remote database: ${res.rows[0].db} (${res.rows[0].now})`);
      } finally {
        client.release();
      }

      isInitialized = true;
      return;
    } catch (connErr: any) {
      console.warn('[PostgreSQL Engine Warning] Remote PostgreSQL connection failed in development:', connErr.message);
      if (pgPool) {
        try {
          await pgPool.end();
        } catch (_) {}
        pgPool = null;
      }
      console.log('[PostgreSQL Engine] Development mode: Falling back to persistent PGlite PostgreSQL engine.');
    }
  }

  console.log('[PostgreSQL Engine] Development mode: Initializing persistent PGlite PostgreSQL engine at:', DATA_DIR);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Helper function to initialize schema and seed data
  const applySchemaAndSeed = async (pg: PGlite) => {
    if (fs.existsSync(SCHEMA_PATH)) {
      const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      await pg.exec(schemaSql);
      console.log('[PostgreSQL Engine] supabase_schema.sql successfully applied.');
    }
    if (fs.existsSync(SEED_PATH)) {
      const seedSql = fs.readFileSync(SEED_PATH, 'utf-8');
      await pg.exec(seedSql);
      console.log('[PostgreSQL Engine] seed_supabase_migration.sql successfully applied.');
    }
  };

  try {
    // Attempt normal boot of PGlite instance
    pgliteInstance = new PGlite(DATA_DIR);

    const tableCheck = await pgliteInstance.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schools';`
    );

    if (tableCheck.rows.length === 0) {
      console.log('[PostgreSQL Engine] First run detected. Applying supabase_schema.sql DDL & seed data...');
      await applySchemaAndSeed(pgliteInstance);
    } else {
      console.log('[PostgreSQL Engine] Existing PostgreSQL database found with tables already created.');
      try {
        if (fs.existsSync(SCHEMA_PATH)) {
          const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
          await pgliteInstance.exec(schemaSql);
          console.log('[PostgreSQL Engine] Schema DDL verified and up to date.');
        }
      } catch (e: any) {
        console.warn('[PostgreSQL Engine] Schema update check notice:', e.message);
      }
    }
  } catch (initErr: any) {
    console.error('[PostgreSQL Engine] PGlite failed on existing directory. Repairing data directory...', initErr.message);
    try {
      if (pgliteInstance) {
        try {
          await pgliteInstance.close();
        } catch (_) {}
      }
      pgliteInstance = null;

      // Clean corrupted/stale data directory
      if (fs.existsSync(DATA_DIR)) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });

      // Fresh initialization
      pgliteInstance = new PGlite(DATA_DIR);
      console.log('[PostgreSQL Engine] Clean data directory initialized. Reapplying schema and seed migration...');
      await applySchemaAndSeed(pgliteInstance);
      console.log('[PostgreSQL Engine] Recovery complete. Database is healthy.');
    } catch (recoverErr: any) {
      console.error('[PostgreSQL Engine Fatal] Recovery failed:', recoverErr);
      throw recoverErr;
    }
  }

  isInitialized = true;
  console.log('[PostgreSQL Engine] Ready.');
}

export async function checkDatabaseHealth(): Promise<{
  status: 'connected' | 'disconnected';
  engine: string;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const db = await getDb();
    await db.query('SELECT 1 as ping');
    return {
      status: 'connected',
      engine: db.engineType,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.error('[PostgreSQL Health Check Error]:', err);
    return {
      status: 'disconnected',
      engine: 'PostgreSQL',
      latencyMs: Date.now() - start,
    };
  }
}

export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    try {
      await pgPool.end();
      console.log('[PostgreSQL Engine] Pool drained and connections closed gracefully.');
    } catch (err) {
      console.error('[PostgreSQL Engine Error during pool close]:', err);
    }
  }
}
