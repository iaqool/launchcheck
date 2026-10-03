import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { loadPersistentDevnetKeypair, prepareDevnetWallet } from '../scripts/devnet-wallet';

test('wallet creation survives a fresh environment and never replaces an existing wallet', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'launchcheck-wallet-')), '.env.devnet.local');
  const first = prepareDevnetWallet(file, {});
  const original = readFileSync(file, 'utf8');
  assert.equal(loadPersistentDevnetKeypair(file, {}).publicKey.toBase58(), first);
  assert.equal(prepareDevnetWallet(file, {}), first);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('missing or malformed wallet fails before a funding address is issued', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'launchcheck-wallet-')), '.env.devnet.local');
  assert.throws(() => loadPersistentDevnetKeypair(file, {}), /Run npm run devnet:wallet/);
  const malformed = 'invalid-private-value';
  writeFileSync(file, `DEVNET_KEYPAIR_JSON=${malformed}\n`);
  assert.throws(() => prepareDevnetWallet(file, {}), (error: unknown) =>
    error instanceof Error && !error.message.includes(malformed));
  assert.equal(readFileSync(file, 'utf8'), `DEVNET_KEYPAIR_JSON=${malformed}\n`);
});

test('explicit environment wallet takes precedence without creating a local file', () => {
  const payer = Keypair.generate();
  const file = join(mkdtempSync(join(tmpdir(), 'launchcheck-wallet-')), '.env.devnet.local');
  const environment = { DEVNET_KEYPAIR_JSON: JSON.stringify(Array.from(payer.secretKey)) };
  assert.equal(prepareDevnetWallet(file, environment), payer.publicKey.toBase58());
  assert.throws(() => readFileSync(file), { code: 'ENOENT' });
});
