import { rootCertificates } from 'node:tls';
import type { PoolConfig } from 'pg';
import { supabaseCa } from './supabase-ca.ts';

export function postgresConfig(
  connectionString: string,
  customCa?: string,
): PoolConfig {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw Object.assign(new Error('Invalid database protocol'), {
      code: 'INVALID_DATABASE_PROTOCOL',
    });
  // pg's URI options override the ssl object, so remove options that would
  // discard our CA or disable verification, including ssl=no-verify.
  for (const key of [
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'uselibpqcompat',
  ])
    url.searchParams.delete(key);
  const host = (url.searchParams.get('host') ?? url.hostname).toLowerCase();
  const isSupabase =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) ||
    /^db\.[a-z0-9]+\.supabase\.co$/.test(host);
  const ca = customCa
    ? customCa.replace(/\\n/g, '\n')
    : isSupabase
      ? [...rootCertificates, supabaseCa]
      : undefined;
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  };
}
