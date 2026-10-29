import type { Command, State } from './domain.ts';

export type WorkspaceSnapshot = {
  state: State;
  revision: number;
  mannerRatings?: Record<string, number>;
};

/** Optional browser-only demonstration; real school requests keep using the API. */
export type WorkspaceClient = {
  load(): Promise<WorkspaceSnapshot>;
  save(command: Command, revision: number): Promise<WorkspaceSnapshot>;
};
