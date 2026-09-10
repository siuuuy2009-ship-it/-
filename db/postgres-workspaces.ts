import type { WorkspaceRow, WorkspaceStore } from '../lib/server/workspace.ts';

export type Query = (
  text: string,
  parameters?: unknown[],
) => Promise<Record<string, unknown>[]>;

// The network driver is separate so these queries can also be tested in PostgreSQL.
export function createPostgresWorkspaces(query: Query): WorkspaceStore {
  let ready: Promise<unknown> | undefined;
  const initialize = () => {
    // Serialize first-use DDL across separate serverless instances.
    ready ??= query(`DO $nanum_setup$ BEGIN
      PERFORM pg_advisory_xact_lock(48129, 2026);
      CREATE SCHEMA IF NOT EXISTS nanum_private;
      REVOKE ALL ON SCHEMA nanum_private FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS nanum_private.workspaces (
      id UUID PRIMARY KEY,
      state TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      updated_at BIGINT NOT NULL
      );
      ALTER TABLE nanum_private.workspaces ENABLE ROW LEVEL SECURITY;
    END $nanum_setup$`).catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  return {
    async find(id) {
      await initialize();
      const rows = await query(
        'SELECT state, revision FROM nanum_private.workspaces WHERE id = $1',
        [id],
      );
      return rows.length ? (rows[0] as WorkspaceRow) : null;
    },
    async create(id, state) {
      await initialize();
      await query(
        'INSERT INTO nanum_private.workspaces (id, state, revision, updated_at) VALUES ($1, $2, 0, $3)',
        [id, JSON.stringify(state), Date.now()],
      );
    },
    async update(id, revision, state) {
      await initialize();
      const rows = await query(
        `UPDATE nanum_private.workspaces
        SET state = $1, revision = revision + 1, updated_at = $2
        WHERE id = $3 AND revision = $4 RETURNING revision`,
        [JSON.stringify(state), Date.now(), id, revision],
      );
      return rows.length === 1;
    },
  };
}
