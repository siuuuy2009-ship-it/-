import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { createPostgresWorkspaces } from './postgres-workspaces.ts';
import {
  StorageNotConfigured,
  type WorkspaceStore,
} from '../lib/server/workspace.ts';

let store: WorkspaceStore | undefined;
export function vercelWorkspaces(): WorkspaceStore {
  if (store) return store;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new StorageNotConfigured();
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid database protocol');
  // Enforce verified TLS even when the copied URI includes weaker SSL options.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    url.searchParams.delete(key);
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_CERT
        ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') }
        : {}),
    },
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on('error', () => console.error('database pool connection failed'));
  attachDatabasePool(pool);
  // Unnamed, parameterized queries work with Supabase's transaction pooler.
  store = createPostgresWorkspaces(
    async (text, parameters) => (await pool.query(text, parameters)).rows,
  );
  return store;
}
