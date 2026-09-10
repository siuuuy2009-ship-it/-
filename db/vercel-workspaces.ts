import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { createPostgresWorkspaces } from './postgres-workspaces.ts';
import { postgresConfig } from './postgres-config.ts';
import { storageErrorCode } from '../lib/server/storage-diagnostics.ts';
import {
  StorageNotConfigured,
  type WorkspaceStore,
} from '../lib/server/workspace.ts';

let store: WorkspaceStore | undefined;
export function vercelWorkspaces(): WorkspaceStore {
  if (store) return store;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new StorageNotConfigured();
  const pool = new Pool(
    postgresConfig(connectionString, process.env.DATABASE_CA_CERT),
  );
  pool.on('error', (error) =>
    console.error(
      `database pool connection failed [${storageErrorCode(error)}]`,
    ),
  );
  attachDatabasePool(pool);
  // Unnamed, parameterized queries work with Supabase's transaction pooler.
  store = createPostgresWorkspaces(
    async (text, parameters) => (await pool.query(text, parameters)).rows,
  );
  return store;
}
