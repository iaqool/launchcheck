import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('../scripts/check-runtime.ts', import.meta.url));

test('public runtime accepts the JavaScript bigint path only when native addons are disabled', () => {
  const safe = spawnSync(process.execPath, ['--no-addons', '--import', 'tsx', checker, '--check-only'],
    { encoding: 'utf8' });
  assert.equal(safe.status, 0, safe.stderr);
  assert.match(safe.stdout, /Read-only runtime check passed/);

  const unsafe = spawnSync(process.execPath, ['--import', 'tsx', checker, '--check-only'],
    { encoding: 'utf8' });
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /run Node with --no-addons/);
  assert.doesNotMatch(unsafe.stdout, /LaunchCheck read-only server/);
});
