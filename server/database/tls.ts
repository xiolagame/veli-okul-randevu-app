export function getPostgresConnectionOptions(databaseUrl: string, isProduction: boolean) {
  const encodedCa = process.env.SUPABASE_DB_CA_B64?.trim();

  if (!encodedCa) {
    if (isProduction) {
      throw new Error('SUPABASE_DB_CA_B64 is required for production PostgreSQL TLS.');
    }
    return { connectionString: databaseUrl, ssl: undefined };
  }

  const ca = Buffer.from(encodedCa, 'base64').toString('utf8');
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]*-----END CERTIFICATE-----\s*$/.test(ca)) {
    throw new Error('Invalid SUPABASE_DB_CA_B64 certificate.');
  }

  const url = new URL(databaseUrl);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    url.searchParams.delete(key);
  }

  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true }
  };
}
