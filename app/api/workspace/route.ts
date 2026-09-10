import { d1Workspaces } from '@/db/d1-workspaces';
import { createWorkspaceHandlers } from '@/lib/server/workspace';

const handlers = createWorkspaceHandlers(d1Workspaces);
export function GET(request: Request) {
  return handlers.GET(request);
}
export function POST(request: Request) {
  return handlers.POST(request);
}
