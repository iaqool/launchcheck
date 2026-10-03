import assert from 'node:assert/strict';
import test from 'node:test';
import { Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadRehearsal, rehearsalSession } from '../scripts/rehearsal-session';
import { assertBudgetRoom, reconcileBudget, submitSignedTransaction, type RehearsalBudget, type RehearsalOptions } from '../scripts/rehearsal';

test('session loads a fresh rehearsal entry module for each attempt', async () => {
  const first = await loadRehearsal();
  const second = await loadRehearsal();
  assert.notEqual(first, second);
});

test('session retains one payer and budget across failed, thrown and successful attempts', async () => {
  const payer = Keypair.generate();
  const calls: RehearsalOptions[] = [];
  const commands = ['run', 'run', 'exit'];
  const logs: string[] = [];
  await rehearsalSession(payer, async options => {
    calls.push(options);
    if (calls.length === 1) { options.budget!.spentLamports = 100_000_000n; return false; }
    if (calls.length === 2) throw new Error('private-provider-error-must-not-be-printed');
    return true;
  }, async () => commands.shift()!, message => logs.push(message));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(options => options.payer === payer && options.waitForFunding === true));
  assert.ok(calls.every(options => options.budget === calls[0].budget && options.budget!.spentLamports === 100_000_000n));
  assert.equal(logs.some(line => line.includes('private-provider-error')), false);
});

function signedTransaction() {
  const payer = Keypair.generate();
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: SystemProgram.programId.toBase58() });
  tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.sign(payer);
  return tx;
}

test('signature is durably recorded before submission and a write failure is never retried', async () => {
  const tx = signedTransaction();
  const budget: RehearsalBudget = {};
  const events: string[] = [];
  let savedSignature = '';
  await assert.rejects(submitSignedTransaction({ sendRawTransaction: async (_bytes, options) => {
    events.push('submit');
    assert.equal(options?.skipPreflight, false);
    assert.equal(savedSignature, bs58.encode(tx.signature!));
    throw new Error('429');
  } }, tx, async signature => {
    budget.pending = { signature, lastValidBlockHeight: 42, step: 'test-write' };
    savedSignature = signature;
    events.push('save');
  }), /429/);
  assert.deepEqual(events, ['save', 'submit']);
  assert.deepEqual(budget.pending, { signature: savedSignature, lastValidBlockHeight: 42, step: 'test-write' });
});

test('failed evidence persistence prevents transaction submission', async () => {
  let submitted = false;
  await assert.rejects(submitSignedTransaction({ sendRawTransaction: async () => {
    submitted = true;
    return '';
  } }, signedTransaction(), async () => { throw new Error('disk unavailable'); }), /disk unavailable/);
  assert.equal(submitted, false);
});

function budgetRpc(payer: Keypair, records: Record<string, { before: number; after: number; failed?: boolean }>,
  status: 'confirmed' | 'unknown' = 'confirmed', blockHeight = 1) {
  return {
    getSignatureStatuses: async () => ({ value: [status === 'confirmed' ? { confirmationStatus: 'confirmed', err: null } : null] }),
    getTransaction: async (signature: string) => {
      const record = records[signature];
      return record ? {
        transaction: { signatures: [signature], message: { getAccountKeys: () => ({ get: () => payer.publicKey }) } },
        meta: { preBalances: [record.before], postBalances: [record.after], err: record.failed ? { InstructionError: [0, 'Custom'] } : null },
      } : null;
    },
    getBlockHeight: async () => blockHeight,
  } as unknown as Pick<Connection, 'getSignatureStatuses' | 'getTransaction' | 'getBlockHeight'>;
}

test('top-up cannot erase cumulative payer debits, including failed transaction fees', async () => {
  const payer = Keypair.generate();
  const budget: RehearsalBudget = { pending: { signature: 'first', lastValidBlockHeight: 100, step: 'swap' } };
  const rpc = budgetRpc(payer, {
    first: { before: 1_000_000_000, after: 700_000_000 },
    // Payer was topped up by 1 SOL between these transactions.
    second: { before: 1_700_000_000, after: 1_500_001_000 },
    third: { before: 1_500_001_000, after: 1_499_996_000, failed: true },
  });
  await reconcileBudget(rpc, payer.publicKey, budget);
  assert.equal(budget.spentLamports, 300_000_000n);
  assertBudgetRoom(budget);
  budget.pending = { signature: 'second', lastValidBlockHeight: 101, step: 'swap' };
  await reconcileBudget(rpc, payer.publicKey, budget);
  assert.equal(budget.spentLamports, 499_999_000n);
  assertBudgetRoom(budget);
  budget.pending = { signature: 'third', lastValidBlockHeight: 102, step: 'failed-swap' };
  await reconcileBudget(rpc, payer.publicKey, budget);
  assert.equal(budget.spentLamports, 500_004_000n);
  assert.equal(budget.pending, undefined);
  assert.throws(() => assertBudgetRoom(budget), /0.5 test SOL/);
});

test('unknown live signature blocks the next write and remains pending', async () => {
  const payer = Keypair.generate();
  const budget: RehearsalBudget = { spentLamports: 10n,
    pending: { signature: 'unknown', lastValidBlockHeight: 100, step: 'create-pool' } };
  const rpc = budgetRpc(payer, {}, 'unknown', 99);
  let writes = 0;
  await assert.rejects(async () => {
    await reconcileBudget(rpc, payer.publicKey, budget);
    assertBudgetRoom(budget);
    writes++;
  }, /unresolved/);
  assert.equal(writes, 0);
  assert.equal(budget.pending?.signature, 'unknown');
  assert.equal(budget.spentLamports, 10n);
});

test('expired absent signature can be cleared without charging the budget', async () => {
  const payer = Keypair.generate();
  const budget: RehearsalBudget = { spentLamports: 25n,
    pending: { signature: 'expired', lastValidBlockHeight: 100, step: 'create-pool' } };
  await reconcileBudget(budgetRpc(payer, {}, 'unknown', 101), payer.publicKey, budget);
  assert.equal(budget.pending, undefined);
  assert.equal(budget.spentLamports, 25n);
});
