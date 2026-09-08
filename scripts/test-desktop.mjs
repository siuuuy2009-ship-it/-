import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn(
  process.execPath,
  ['desktop-build/server.mjs', 'desktop-build/static', 'work/desktop-test'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const timeout = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 30000);
try {
  for await (const line of createInterface({ input: child.stdout })) {
    const { url } = JSON.parse(line);
    const response = await fetch(url);
    if (response.status !== 200) throw new Error('Desktop page failed');
    const check = spawn(process.execPath, ['scripts/test-api.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, TEST_BASE_URL: url },
    });
    const code = await new Promise((resolve) => check.on('exit', resolve));
    if (code !== 0) throw new Error('Desktop API checks failed');
    console.log('Desktop server and shared API checks passed.');
    break;
  }
} finally {
  clearTimeout(timeout);
  child.kill();
}
