import { getPostgresConnectionOptions } from './tls';
// ==============================================================================
// VELÄ° - OKUL RANDEVU SÄ°STEMÄ°: UNIFIED POSTGRESQL DATA ENGINE
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
const MIGRATIONS_DIR = path.join(process.cwd(), 'server', 'database', 'migrations');
const DATA_DIR = path.join(process.cwd(), 'server', 'data', 'postgres_db');

export async function getDb(): Promise<{
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
  transaction: <T>(fn: (tx: TransactionClient) => Promise<T>) => Promise<T>;
  engineType: string;
}> {
  if (!isInitialized) {
    await initDatabase();
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
        let releaseError: Error | undefined;
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
          try {
            await client.query('ROLLBACK');
          } catch {
            releaseError = new Error('PostgreSQL transaction connection unavailable');
          }
          throw err;
        } finally {
          client.release(releaseError);
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
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = initializeDatabase().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

async function initializeDatabase(): Promise<void> {
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
        'KRÄ°TÄ°K HATA (Production Fail-Fast): NODE_ENV=production modunda DATABASE_URL ortam deÄŸiÅŸkeni zorunludur! PGlite / Embedded veritabanÄ± veya store.json fallback kesinlikle yasaktÄ±r.'
      );
    }

    if (isPlaceholderPassword) {
      throw new Error(
        'KRÄ°TÄ°K HATA (Production Fail-Fast): DATABASE_URL ortam deÄŸiÅŸkeninde "[YOUR-PASSWORD]" yer tutucusu tespit edildi! CanlÄ± Supabase PostgreSQL ÅŸifrenizi Secrets panelinde tanÄ±mlamalÄ±sÄ±nÄ±z. PGlite veya store.json fallback kesinlikle yasaktÄ±r.'
      );
    }

    console.log('[PostgreSQL Engine] Connecting to remote PostgreSQL cluster via connection pool...');
    try {
      pgPool = new Pool({
        ...getPostgresConnectionOptions(databaseUrl, isProduction),
        // Each warm serverless instance has its own pool. Queue locally rather
        // than consuming the session pooler's entire connection allowance.
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 5000,
      });
      pgPool.on('error', () => {
        console.error('[PostgreSQL Engine] Idle connection lost; pool will reconnect on demand.');
      });

      // Test connection
      const client = await pgPool.connect();
      try {
        await client.query('SELECT 1');
        console.log('[PostgreSQL Engine] Remote database connection verified.');
      } finally {
        client.release();
      }

      isInitialized = true;
      return;
    } catch {
      console.error('[PostgreSQL Engine] Remote database connection unavailable.');
      // Clean pool reference on failure
      if (pgPool) {
        try {
          await pgPool.end();
        } catch (_) {}
        pgPool = null;
      }
      // In production, or whenever DATABASE_URL was provided, connection failure MUST fail-fast!
      // Strictly NO fallback to PGlite or in-memory/JSON stores.
      throw new Error('PostgreSQL connection unavailable');
    }
  }

  // Development & Test ONLY: Use persistent PGlite PostgreSQL instance
  if (databaseUrl && !isPlaceholderPassword) {
    console.log('[PostgreSQL Engine] Connecting to remote PostgreSQL cluster via connection pool (development)...');
    try {
      pgPool = new Pool({
        ...getPostgresConnectionOptions(databaseUrl, isProduction),
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      pgPool.on('error', () => {
        console.error('[PostgreSQL Engine] Idle connection lost; pool will reconnect on demand.');
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

  const applyDevelopmentMigrations = async (pg: PGlite) => {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return;
    }

    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);
      await pg.exec(fs.readFileSync(migrationPath, 'utf-8'));
      console.log(`[PostgreSQL Engine] Development migration applied: ${migrationFile}`);
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

    await applyDevelopmentMigrations(pgliteInstance);
  } catch (initErr: any) {
    if (pgliteInstance) {
      try {
        await pgliteInstance.close();
      } catch (_) {}
    }
    pgliteInstance = null;
    throw new Error(
      `[PostgreSQL Engine] Local PGlite initialization failed without modifying existing data: ${initErr.message}`
    );
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
      pgPool = null;
      isInitialized = false;
      initPromise = null;
      console.log('[PostgreSQL Engine] Pool drained and connections closed gracefully.');
    } catch (err) {
      console.error('[PostgreSQL Engine Error during pool close]:', err);
    }
  }
}
