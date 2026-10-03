import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { Cluster, InspectionReport } from '../src/shared/report';
import { createHandler } from '../src/server/app';
import { demoReport } from '../src/server/demo';

const VALID_ADDRESS = '11111111111111111111111111111111';
type Inspector = (address: string, cluster: Cluster, rpc: string) => Promise<InspectionReport>;

async function withApi(inspector: Inspector, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(createHandler(inspector));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

type ApiResponse = { status: number; json: () => Promise<{ error?: { code: string; message: string }; [key: string]: unknown }> };
function apiRequest(baseUrl: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<ApiResponse> {
  const target = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: Number(target.port), path: `${target.pathname}${target.search}`, method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, json: async () => JSON.parse(content) });
      });
    });
    request.once('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function jsonResponse(response: ApiResponse) {
  return response.json() as Promise<{ error?: { code: string; message: string }; [key: string]: unknown }>;
}

test('invalid pool address and cluster are rejected before inspector or RPC access', async () => {
  let calls = 0;
  await withApi(async () => { calls++; return demoReport('trading'); }, async (baseUrl) => {
    const invalidAddress = await apiRequest(baseUrl, '/api/inspect?address=not-a-pool&cluster=devnet');
    assert.equal(invalidAddress.status, 400);
    assert.equal((await jsonResponse(invalidAddress)).error?.code, 'INVALID_ADDRESS');

    const invalidCluster = await apiRequest(baseUrl, `/api/inspect?address=${VALID_ADDRESS}&cluster=localnet`);
    assert.equal(invalidCluster.status, 400);
    assert.equal((await jsonResponse(invalidCluster)).error?.code, 'INVALID_CLUSTER');
  });
  assert.equal(calls, 0);
});

test('inspection forwards only supported address and cluster and selects RPC from server environment', async () => {
  const oldMainnet = process.env.SOLANA_MAINNET_RPC_URL;
  const oldDevnet = process.env.SOLANA_DEVNET_RPC_URL;
  process.env.SOLANA_MAINNET_RPC_URL = 'https://mainnet.example/rpc?key=server-main-secret';
  process.env.SOLANA_DEVNET_RPC_URL = 'https://devnet.example/rpc?key=server-dev-secret';
  const calls: Array<{ address: string; cluster: Cluster; rpc: string }> = [];
  try {
    await withApi(async (address, cluster, rpc) => {
      calls.push({ address, cluster, rpc });
      return demoReport('trading');
    }, async (baseUrl) => {
      for (const cluster of ['mainnet-beta', 'devnet'] as const) {
        const response = await apiRequest(baseUrl, `/api/inspect?address=${VALID_ADDRESS}&cluster=${cluster}&rpc=https%3A%2F%2Fevil.example`);
        assert.equal(response.status, 200);
      }
    });
  } finally {
    if (oldMainnet === undefined) delete process.env.SOLANA_MAINNET_RPC_URL; else process.env.SOLANA_MAINNET_RPC_URL = oldMainnet;
    if (oldDevnet === undefined) delete process.env.SOLANA_DEVNET_RPC_URL; else process.env.SOLANA_DEVNET_RPC_URL = oldDevnet;
  }
  assert.deepEqual(calls, [
    { address: VALID_ADDRESS, cluster: 'mainnet-beta', rpc: 'https://mainnet.example/rpc?key=server-main-secret' },
    { address: VALID_ADDRESS, cluster: 'devnet', rpc: 'https://devnet.example/rpc?key=server-dev-secret' },
  ]);
});

test('known RPC errors and unexpected inspector errors do not fall back to demo or expose RPC secrets', async () => {
  const oldMainnet = process.env.SOLANA_MAINNET_RPC_URL;
  const secretRpc = 'https://private-rpc.example/?api-key=never-return-this';
  process.env.SOLANA_MAINNET_RPC_URL = secretRpc;
  try {
    await withApi(async (_address, _cluster, rpc) => {
      if (rpc !== secretRpc) throw new Error('unexpected rpc');
      const error = new Error('The RPC read failed or timed out.') as Error & { code: string };
      error.code = 'RPC_UNAVAILABLE';
      throw error;
    }, async (baseUrl) => {
      const known = await apiRequest(baseUrl, `/api/inspect?address=${VALID_ADDRESS}`);
      assert.equal(known.status, 503);
      const knownBody = await jsonResponse(known);
      assert.equal(knownBody.error?.code, 'RPC_UNAVAILABLE');
      assert.equal(knownBody.source, undefined);
      assert.equal(JSON.stringify(knownBody).includes(secretRpc), false);
      assert.equal(JSON.stringify(knownBody).includes('never-return-this'), false);
    });

    await withApi(async () => { throw new Error(`Internal transport failure at ${secretRpc}`); }, async (baseUrl) => {
      const response = await apiRequest(baseUrl, `/api/inspect?address=${VALID_ADDRESS}`);
      assert.equal(response.status, 502);
      const body = await jsonResponse(response);
      assert.equal(body.error?.code, 'INSPECTION_FAILED');
      assert.equal(JSON.stringify(body).includes(secretRpc), false);
      assert.equal(body.source, undefined);
    });
  } finally {
    if (oldMainnet === undefined) delete process.env.SOLANA_MAINNET_RPC_URL; else process.env.SOLANA_MAINNET_RPC_URL = oldMainnet;
  }
});

test('demo endpoint supports only named scenarios and every returned sample stays marked demo', async () => {
  let calls = 0;
  await withApi(async () => { calls++; return demoReport('trading'); }, async (baseUrl) => {
    for (const scenario of ['trading', 'pending', 'migrated']) {
      const response = await apiRequest(baseUrl, `/api/demo?scenario=${scenario}`);
      assert.equal(response.status, 200);
      const report = await jsonResponse(response) as unknown as InspectionReport;
      assert.equal(report.source, 'demo');
    }
    const unsupported = await apiRequest(baseUrl, '/api/demo?scenario=unknown');
    assert.equal(unsupported.status, 400);
    assert.equal((await jsonResponse(unsupported)).error?.code, 'INVALID_SCENARIO');
  });
  assert.equal(calls, 0);
});

test('comparison rejects reports for a different pool or with a live/demo source mismatch', async () => {
  await withApi(async () => demoReport('trading'), async (baseUrl) => {
    const baseline = demoReport('trading');
    const wrongPool = structuredClone(baseline);
    wrongPool.pool.address = '22222222222222222222222222222222';
    const poolResponse = await apiRequest(baseUrl, '/api/compare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseline, current: wrongPool }),
    });
    assert.equal(poolResponse.status, 400);
    assert.equal((await jsonResponse(poolResponse)).error?.code, 'INVALID_COMPARISON');

    const sourceMismatch = structuredClone(baseline);
    sourceMismatch.source = 'live';
    const sourceResponse = await apiRequest(baseUrl, '/api/compare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseline, current: sourceMismatch }),
    });
    assert.equal(sourceResponse.status, 400);
    assert.equal((await jsonResponse(sourceResponse)).error?.code, 'INVALID_COMPARISON');
  });
});

test('API denies cross-origin requests before calling inspector', async () => {
  let calls = 0;
  await withApi(async () => { calls++; return demoReport('trading'); }, async (baseUrl) => {
    const response = await apiRequest(baseUrl, `/api/inspect?address=${VALID_ADDRESS}`, { headers: { origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.equal((await jsonResponse(response)).error?.code, 'ORIGIN_REJECTED');
  });
  assert.equal(calls, 0);
});

test('health probes do not consume API quota and stay available when it is exhausted', async () => {
  await withApi(async () => demoReport('trading'), async (baseUrl) => {
    for (let i = 0; i < 61; i++) assert.equal((await apiRequest(baseUrl, '/api/health')).status, 200);
    for (let i = 0; i < 60; i++) assert.equal((await apiRequest(baseUrl, '/api/demo')).status, 200);
    assert.equal((await apiRequest(baseUrl, '/api/demo')).status, 429);
    assert.equal((await apiRequest(baseUrl, '/api/health')).status, 200);
    assert.equal((await apiRequest(baseUrl, '/api/health', { headers: { origin: 'https://attacker.example' } })).status, 403);
  });
});
