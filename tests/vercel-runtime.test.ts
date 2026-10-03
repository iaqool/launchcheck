import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const cwd = resolve(import.meta.dirname, '..');

function run(flags: string[], code: string): string {
  return execFileSync(process.execPath, [...flags, '--import', 'tsx', '--input-type=module', '-e', code], {
    cwd, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '' },
  }).trim();
}

test('Vercel API entry refuses a runtime that can load native addons', () => {
  const output = run([], `
    import handler from './api/index.ts';
    try { await handler({ url: '/api/index?__launchcheck_route=health' }, {}); process.exitCode = 1; }
    catch (error) {
      if (!String(error).includes('run Node with --no-addons')) process.exitCode = 1;
      else console.log('blocked');
    }
  `);
  assert.equal(output, 'blocked');
});

test('guarded Vercel API entry preserves routes, query, body, and Origin checks', () => {
  const output = run(['--no-addons'], `
    import { Readable } from 'node:stream';
    import handler from './api/index.ts';
    async function call(path, method = 'GET', headers = {}, content = '') {
      const req = Readable.from(content ? [Buffer.from(content)] : []);
      req.url = path; req.method = method; req.headers = { host: 'demo.example', ...headers };
      req.socket = { remoteAddress: '127.0.0.1' };
      const res = {
        headersSent: false,
        setHeader() {},
        writeHead(status) { this.status = status; this.headersSent = true; return this; },
        end(chunk) { this.body = chunk?.toString() ?? ''; return this; },
      };
      await handler(req, res);
      return [res.status, JSON.parse(res.body)];
    }
    const health = await call('/api/index?__launchcheck_route=health');
    const trading = await call('/api/index?__launchcheck_route=demo&scenario=trading');
    const demo = await call('/api/index?__launchcheck_route=demo&scenario=pending');
    const invalid = await call('/api/index?__launchcheck_route=missing');
    const origin = await call('/api/index?__launchcheck_route=demo', 'GET', { origin: 'https://other.example' });
    const comparePath = '/api/index?__launchcheck_route=compare';
    const jsonHeaders = { 'content-type': 'application/json' };
    const compare = await call(comparePath, 'POST', jsonHeaders, JSON.stringify({ baseline: trading[1], current: demo[1] }));
    const invalidJson = await call(comparePath, 'POST', jsonHeaders, '{');
    console.log(JSON.stringify({
      health: [health[0], health[1].status],
      demo: [demo[0], demo[1].launch.stage],
      invalid: [invalid[0], invalid[1].error.code],
      origin: [origin[0], origin[1].error.code],
      compare: [compare[0], compare[1].changes.map(change => change.field), compare[1].changes.every(change => change.category === 'state')],
      invalidJson: [invalidJson[0], invalidJson[1].error.code],
    }));
  `);
  assert.deepEqual(JSON.parse(output), {
    health: [200, 'ok'],
    demo: [200, 'migration-ready'],
    invalid: [404, 'NOT_FOUND'],
    origin: [403, 'ORIGIN_REJECTED'],
    compare: [200, ['pool.quoteReserve', 'launch.stage'], true],
    invalidJson: [400, 'INVALID_COMPARISON'],
  });
});
