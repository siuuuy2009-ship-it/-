import { vercelSchool } from '../db/vercel-workspaces.ts';
import { createSchoolHandlers } from '../lib/server/school.ts';

const handlers = createSchoolHandlers(vercelSchool);
export function GET(request: Request) {
  return handlers.GET(request);
}
export function POST(request: Request) {
  return handlers.POST(request);
}
