import { env } from 'cloudflare:workers';
export function database(): D1Database {
  if (!env.DB) throw new Error('D1 DB binding unavailable');
  return env.DB as D1Database;
}
