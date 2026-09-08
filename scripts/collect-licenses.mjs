import { mkdirSync, globSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const destination = 'desktop-build/licenses';
mkdirSync(destination, { recursive: true });
let index = 0;
for (const file of globSync([
  'node_modules/.pnpm/*/node_modules/*/LICENSE*',
  'node_modules/.pnpm/*/node_modules/@*/*/LICENSE*',
])) {
  try {
    copyFileSync(file, join(destination, `${index++}-${basename(file)}`));
  } catch {
    /* License directories are not files. */
  }
}
const response = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
);
if (!response.ok)
  throw new Error(`Node license download failed: ${response.status}`);
writeFileSync(join(destination, 'NODE-LICENSE.txt'), await response.text());
writeFileSync(
  join(destination, 'NOTICE.txt'),
  'DasiNanum bundles Node.js, Python, React, Base UI, Lucide, and other open-source components. This folder preserves the upstream license notices included in the build dependencies. Application source: https://github.com/siuuuy2009-ship-it/-\n',
);
console.log(
  `Collected ${index} dependency license notices and the Node.js license.`,
);
