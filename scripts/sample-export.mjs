// Regenerates sample/anatomy-demo-package-scorm12.zip by driving the real authoring UI in a browser
// (the same path a lecturer takes). Requires `npm run build` first. Usage: npm run sample:export
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['playwright', 'test', 'tests/e2e/sample.spec.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, WRITE_SAMPLE: '1' },
});
process.exit(r.status ?? 1);
