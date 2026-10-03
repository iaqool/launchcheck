import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Fail before opening the public server if a native addon could be loaded. */
export function assertReadOnlyRuntime(): void {
  try {
    process.dlopen({ exports: {} } as NodeModule, 'launchcheck-no-such-addon.node');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_DLOPEN_DISABLED') {
      const require = createRequire(import.meta.url);
      const { toBigIntLE } = require('bigint-buffer') as { toBigIntLE: (value: Buffer) => bigint };
      if (toBigIntLE(Buffer.from([0x78, 0x56, 0x34, 0x12])) === 0x12345678n) return;
      throw new Error('The bigint-buffer JavaScript conversion check failed.');
    }
  }
  throw new Error('Refusing public server start: run Node with --no-addons.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertReadOnlyRuntime();
  if (process.argv.includes('--check-only')) console.log('Read-only runtime check passed.');
  else await import('../src/server/index.js');
}
