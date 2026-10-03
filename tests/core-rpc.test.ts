import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import BN from 'bn.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveClient,
  DynamicBondingCurveIdl,
  deriveDbcPoolAddress,
  deriveDammV2PoolAddress,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, CpAmmIdl, type PoolState } from '@meteora-ag/cp-amm-sdk';
import { inspectPool, InspectionError } from '../src/core/inspect.js';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const key = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
const configKey = key(31);
const baseMint = key(32);
const poolKey = deriveDbcPoolAddress(NATIVE_MINT, baseMint, configKey);

type RpcAccount = { data: [string, 'base64']; executable: boolean; lamports: number; owner: string; rentEpoch: number; space: number };
function account(data: Buffer, owner: PublicKey): RpcAccount {
  return { data: [data.toString('base64'), 'base64'], executable: false, lamports: 1, owner: owner.toBase58(), rentEpoch: 0, space: data.length };
}

// Real SDK coder, discriminator, and bytemuck layouts; zeroed accounts are
// decoded and re-encoded after setting the fields this inspector reads.
const coder = DynamicBondingCurveClient.create(new Connection('http://127.0.0.1:1')).state.program.coder.accounts;
function emptyAccount<T>(name: 'virtualPool' | 'transferHookPool' | 'poolConfig'): T {
  const entry = DynamicBondingCurveIdl.accounts.find(account => account.name.toLowerCase() === name.toLowerCase());
  assert.ok(entry);
  const data = Buffer.concat([Buffer.from(entry.discriminator), Buffer.alloc(coder.size(name) - 8)]);
  return coder.decode<T>(name, data);
}

async function encodeFixture(name: 'virtualPool' | 'transferHookPool' | 'poolConfig', value: object): Promise<Buffer> {
  if (coder.size(name) <= 1000) return coder.encode(name, value);
  // Anchor's public encode() allocates only 1000 bytes, while PoolConfig is
  // 1048 bytes. Use the same SDK Borsh layout with the declared account size.
  const layout = (coder as unknown as { accountLayouts: Map<string, { layout: { encode(value: object, data: Buffer): number } }> }).accountLayouts.get(name)?.layout;
  assert.ok(layout);
  const data = Buffer.alloc(coder.size(name) - 8);
  const length = layout.encode(value, data);
  const entry = DynamicBondingCurveIdl.accounts.find(account => account.name.toLowerCase() === name.toLowerCase());
  assert.ok(entry);
  return Buffer.concat([Buffer.from(entry.discriminator), data.subarray(0, length)]);
}

async function fixture(transferHook = false, migrationOption = 1, migrated = false, dammExists = false): Promise<Map<string, RpcAccount>> {
  const name = transferHook ? 'transferHookPool' : 'virtualPool';
  const pool = emptyAccount<VirtualPool>(name);
  pool.poolState.config = configKey;
  pool.poolState.baseMint = baseMint;
  pool.poolState.creator = key(33);
  pool.poolState.quoteReserve = new BN('9007199254740993');
  pool.poolState.poolType = 0;
  pool.poolState.migrationProgress = migrated ? 3 : 0;
  pool.poolState.isMigrated = migrated ? 1 : 0;
  const config = emptyAccount<PoolConfig>('poolConfig');
  config.quoteMint = NATIVE_MINT;
  config.feeClaimer = key(34);
  config.leftoverReceiver = key(35);
  config.tokenType = 0;
  config.quoteTokenFlag = 0;
  config.tokenDecimal = 6;
  config.migrationOption = migrationOption;
  config.migrationFeeOption = 0;
  config.migrationQuoteThreshold = new BN('18014398509481986');
  config.partnerLiquidityPercentage = 100;
  config.poolFees.baseFee.cliffFeeNumerator = new BN(2_500_000);
  const mint = (decimals: number) => {
    const data = Buffer.alloc(82);
    data[44] = decimals;
    data[45] = 1;
    return account(data, TOKEN_PROGRAM_ID);
  };
  const accounts = new Map([
    [poolKey.toBase58(), account(await encodeFixture(name, pool), DYNAMIC_BONDING_CURVE_PROGRAM_ID)],
    [configKey.toBase58(), account(await encodeFixture('poolConfig', config), DYNAMIC_BONDING_CURVE_PROGRAM_ID)],
    [baseMint.toBase58(), mint(6)],
    [NATIVE_MINT.toBase58(), mint(9)],
  ]);
  if (dammExists) {
    const cpCoder = new CpAmm(new Connection('http://127.0.0.1:1'))._program.coder.accounts;
    const idlAccount = CpAmmIdl.accounts.find(entry => entry.name === 'Pool');
    assert.ok(idlAccount);
    const zero = Buffer.concat([Buffer.from(idlAccount.discriminator), Buffer.alloc(cpCoder.size('pool') - 8)]);
    const damm = cpCoder.decode<PoolState>('pool', zero);
    damm.tokenAMint = baseMint;
    damm.tokenBMint = NATIVE_MINT;
    const layout = (cpCoder as unknown as { accountLayouts: Map<string, { layout: { encode(value: object, data: Buffer): number } }> }).accountLayouts.get('pool')?.layout;
    assert.ok(layout);
    const data = Buffer.alloc(cpCoder.size('pool') - 8);
    const length = layout.encode(damm, data);
    const dammKey = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[0], baseMint, NATIVE_MINT);
    accounts.set(dammKey.toBase58(), account(Buffer.concat([Buffer.from(idlAccount.discriminator), data.subarray(0, length)]), DAMM_V2_PROGRAM_ID));
  }
  return accounts;
}

async function rpcServer(accounts: Map<string, RpcAccount>, genesis = DEVNET_GENESIS, hang = false): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const message = JSON.parse(body) as { id: number; method: string; params?: string[] };
      if (hang) return;
      const result = message.method === 'getGenesisHash'
        ? genesis
        : message.method === 'getAccountInfo'
          ? { context: { slot: 42 }, value: accounts.get(message.params?.[0] ?? '') ?? null }
          : null;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function withRpc(accounts: Map<string, RpcAccount>, run: (url: string) => Promise<void>, genesis = DEVNET_GENESIS, hang = false) {
  const { server, url } = await rpcServer(accounts, genesis, hang);
  try { await run(url); }
  finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

async function expectCode(url: string, code: InspectionError['code']) {
  await assert.rejects(inspectPool(poolKey.toBase58(), 'devnet', url), error => error instanceof InspectionError && error.code === code);
}

test('SDK-serialized DBC accounts yield exact report quantities', async () => {
  await withRpc(await fixture(), async url => {
    const report = await inspectPool(poolKey.toBase58(), 'devnet', url);
    assert.equal(report.pool.quoteReserve, '9007199.254740993');
    assert.equal(report.pool.progressPercent, 50);
    assert.equal(report.slot, 42);
    assert.equal(report.launch.stage, 'trading');
    assert.equal(report.migration.verified, null);
  });
});

test('missing pool and foreign owner are distinct from unsupported DBC layout', async () => {
  const accounts = await fixture();
  await withRpc(new Map(), url => expectCode(url, 'POOL_NOT_FOUND'));
  accounts.set(poolKey.toBase58(), { ...accounts.get(poolKey.toBase58())!, owner: PublicKey.default.toBase58() });
  await withRpc(accounts, url => expectCode(url, 'WRONG_OWNER'));
  await withRpc(await fixture(true), url => expectCode(url, 'UNSUPPORTED_POOL'));
});

test('SDK-serialized DAMM v1 target is rejected explicitly', async () => {
  await withRpc(await fixture(false, 0), url => expectCode(url, 'UNSUPPORTED_POOL'));
});

test('created migration requires an existing, valid DAMM v2 pool account', async () => {
  await withRpc(await fixture(false, 1, true), async url => {
    const report = await inspectPool(poolKey.toBase58(), 'devnet', url);
    assert.equal(report.launch.stage, 'unknown');
    assert.equal(report.migration.verified, false);
    assert.equal(report.migration.dammPoolAddress, null);
  });
  await withRpc(await fixture(false, 1, true, true), async url => {
    const report = await inspectPool(poolKey.toBase58(), 'devnet', url);
    assert.equal(report.launch.stage, 'migrated');
    assert.equal(report.migration.verified, true);
    assert.equal(report.checks.find(check => check.id === 'position-locks')?.status, 'unknown');
  });
});

test('wrong genesis and unresponsive RPC are classified without leaking URL', async () => {
  await withRpc(new Map(), url => expectCode(url, 'RPC_UNAVAILABLE'), MAINNET_GENESIS);
  await withRpc(new Map(), async url => {
    await assert.rejects(inspectPool(poolKey.toBase58(), 'devnet', url), error =>
      error instanceof InspectionError && error.code === 'RPC_UNAVAILABLE' && !error.message.includes(url));
  }, DEVNET_GENESIS, true);
});
