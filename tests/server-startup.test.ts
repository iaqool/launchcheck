import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, get } from 'node:http';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function withServer(host: string | undefined, run: (port: number) => Promise<void>) {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  if (host === undefined) delete env.HOST;
  else env.HOST = host;
  const child = spawn(process.execPath, ['--no-addons', '--import', 'tsx', 'scripts/check-runtime.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes(`:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    assert.ok(output.includes(`http://${host ?? '127.0.0.1'}:${port}`), output);
    try { await run(port); }
    catch (error) { throw new Error(`Server request failed for HOST=${host ?? '(default)'} (exit=${child.exitCode}): ${output}; cause=${error instanceof Error ? String(error.cause) : String(error)}`, { cause: error }); }
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.kill();
      await stopped;
    }
  }
}

test('server starts on loopback by default and accepts an explicit container bind address', async () => {
  for (const host of [undefined, '0.0.0.0']) {
    await withServer(host, async (port) => {
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        get(`http://127.0.0.1:${port}/api/health`, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }).once('error', reject);
      });
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).mode, 'read-only');
    });
  }
});

test('invalid PORT and blank HOST fail before listening', () => {
  for (const [port, host, message] of [['0', '127.0.0.1', 'PORT must'], ['65536', '127.0.0.1', 'PORT must'], ['4174', '', 'HOST must']]) {
    const result = spawnSync(process.execPath, ['--no-addons', '--import', 'tsx', 'scripts/check-runtime.ts'], {
      env: { ...process.env, PORT: port, HOST: host }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 1, `${port}/${host}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(message));
  }
});
