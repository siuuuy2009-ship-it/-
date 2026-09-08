import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    'wrangler.local.json',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false',
      WRANGLER_LOG_PATH: '.wrangler/logs',
      MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
    },
  },
);
process.exit(result.status ?? 1);
