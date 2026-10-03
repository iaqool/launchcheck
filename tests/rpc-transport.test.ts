import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectionConfig } from '@solana/web3.js';
import { createRpcFetch } from '../src/core/rpc.js';

type RpcFetch = NonNullable<ConnectionConfig['fetch']>;
const endpoint = 'https://transport-test.invalid';
const request = (method: string) => ({
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 'test', method, params: [] }),
  headers: { 'Content-Type': 'application/json' },
});
const ok = () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', result: 123 }), { status: 200 });

test('retries HTTP 429 on a read and returns the successful response', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ minIntervalMs: 0, fetch: (async () => {
    calls++;
    return calls === 1 ? new Response('limited', { status: 429 }) : ok();
  }) as RpcFetch });
  const response = await fetch(endpoint, request('getGenesisHash'));
  assert.equal(calls, 2);
  assert.equal((await response.json()).result, 123);
});

test('retries JSON-RPC error code 429 on a read', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ minIntervalMs: 0, fetch: (async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', error: { code: 429, message: 'rate limited' } }))
      : ok();
  }) as RpcFetch });
  const response = await fetch(endpoint, request('getAccountInfo'));
  assert.equal(calls, 2);
  assert.equal((await response.json()).result, 123);
});

test('respects Retry-After on HTTP 429', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ minIntervalMs: 0, fetch: (async () => {
    calls++;
    return calls === 1
      ? new Response('limited', { status: 429, headers: { 'Retry-After': '1' } })
      : ok();
  }) as RpcFetch });
  const started = Date.now();
  assert.equal((await fetch(endpoint, request('getSlot'))).status, 200);
  assert.equal(calls, 2);
  assert.ok(Date.now() - started >= 900);
});

test('stops retrying after the bounded number of read attempts', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ minIntervalMs: 0, maxReadRetries: 1, fetch: (async () => {
    calls++;
    return new Response('limited', { status: 429 });
  }) as RpcFetch });
  const response = await fetch(endpoint, request('getSlot'));
  assert.equal(calls, 2);
  assert.equal(response.status, 429);
});

test('never retries writes or mixed batches', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ minIntervalMs: 0, fetch: (async () => {
    calls++;
    return new Response('limited', { status: 429 });
  }) as RpcFetch });
  for (const method of ['sendTransaction', 'requestAirdrop', 'unknownMethod']) {
    assert.equal((await fetch(endpoint, request(method))).status, 429);
  }
  const mixed = { method: 'POST', body: JSON.stringify([
    { method: 'getSlot', params: [] }, { method: 'sendTransaction', params: [] },
  ]) };
  assert.equal((await fetch(endpoint, mixed)).status, 429);
  assert.equal(calls, 4);
});

test('aborts a stalled fetch after the configured timeout', async () => {
  let calls = 0;
  const fetch = createRpcFetch({ timeoutMs: 20, minIntervalMs: 0, fetch: (async (_url, init) => {
    calls++;
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      const stalled = setTimeout(() => resolve(ok()), 1_000);
      signal.addEventListener('abort', () => { clearTimeout(stalled); reject(signal.reason); }, { once: true });
    });
  }) as RpcFetch });
  await assert.rejects(fetch(endpoint, request('getSlot')), error => error instanceof Error && error.name === 'TimeoutError');
  assert.equal(calls, 1);
});

test('serializes requests from separate adapters on a public endpoint', async () => {
  const starts: number[] = [];
  const underlying = (async () => { starts.push(Date.now()); return ok(); }) as RpcFetch;
  const first = createRpcFetch({ minIntervalMs: 30, fetch: underlying });
  const second = createRpcFetch({ minIntervalMs: 30, fetch: underlying });
  await Promise.all([
    first('https://api.devnet.solana.com', request('getSlot')),
    second('https://api.devnet.solana.com', request('getSlot')),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 20, `starts too close: ${starts}`);
});
