import { vercelWorkspaces } from '../db/vercel-workspaces.ts';
import { createWorkspaceHandlers } from '../lib/server/workspace.ts';

const handlers = createWorkspaceHandlers(vercelWorkspaces);
export function GET(request: Request) {
  return handlers.GET(request);
}
export function POST(request: Request) {
  return handlers.POST(request);
}
