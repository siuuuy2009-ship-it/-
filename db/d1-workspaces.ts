import { database } from './storage';
import type { WorkspaceRow, WorkspaceStore } from '../lib/server/workspace.ts';

export function d1Workspaces(): WorkspaceStore {
  const db = database();
  return {
    find: (id) =>
      db
        .prepare('SELECT state, revision FROM workspaces WHERE id = ?')
        .bind(id)
        .first<WorkspaceRow>(),
    async create(id, state) {
      await db
        .prepare(
          'INSERT INTO workspaces (id, state, revision, updated_at) VALUES (?, ?, 0, ?)',
        )
        .bind(id, JSON.stringify(state), Date.now())
        .run();
    },
    async update(id, revision, state) {
      const result = await db
        .prepare(
          'UPDATE workspaces SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .bind(JSON.stringify(state), Date.now(), id, revision)
        .run();
      return result.meta.changes === 1;
    },
  };
}
