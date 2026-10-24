import { getPostgresConnectionOptions } from './tls';
// ==============================================================================
// VELÄ° - OKUL RANDEVU SÄ°STEMÄ°: SUPABASE POSTGRESQL CLIENT
// Server-side only: Uses Service Role Key or DATABASE_URL.
// Strictly forbidden from client bundle.
// ==============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

export interface DatabaseConfig {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
  isProduction: boolean;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
    databaseUrl: process.env.DATABASE_URL,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

let supabaseInstance: SupabaseClient | null = null;
let pgPoolInstance: Pool | null = null;

/**
 * Initializes and returns the Supabase client using Service Role Key.
 * Service Role Key has administrative privileges, bypassing RLS for server operations.
 */
export function getSupabaseClient(): SupabaseClient | null {
  const config = getDatabaseConfig();

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    if (config.isProduction) {
      throw new Error(
        'KRÄ°TÄ°K HATA (Production Fail-Fast): SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam deÄŸiÅŸkenleri tanÄ±mlanmamÄ±ÅŸ! Production veritabanÄ± baÄŸlantÄ±sÄ± zorunludur.'
      );
    }
    return null;
  }

  if (!supabaseInstance) {
    supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseInstance;
}

/**
 * Initializes and returns the raw PostgreSQL connection pool.
 * Useful for complex transactions or direct SQL migration executions.
 */
export function getPgPool(): Pool | null {
  const config = getDatabaseConfig();

  if (!config.databaseUrl) {
    return null;
  }

  if (!pgPoolInstance) {
    pgPoolInstance = new Pool({
      ...getPostgresConnectionOptions(config.databaseUrl, config.isProduction),
      max: 20,
      idleTimeoutMillis: 30000,
    });
  }

  return pgPoolInstance;
}
