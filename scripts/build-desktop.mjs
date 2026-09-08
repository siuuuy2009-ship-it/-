import { spawnSync } from 'node:child_process';
for (const config of [
  'vite.desktop.config.ts',
  'vite.desktop-server.config.ts',
]) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--config', config],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
