import test from 'node:test';
import assert from 'node:assert/strict';
import { displayAmount } from '../src/ui/App';

test('UI displays already-scaled whole token amounts without converting twice', () => {
  assert.equal(displayAmount('10', 'SOL'), '10 SOL');
  assert.equal(displayAmount('0.000000001', 'SOL'), '0.000000001 SOL');
  assert.equal(displayAmount('9007199254740993.000000001', 'SOL'), '9,007,199,254,740,993.000000001 SOL');
});
