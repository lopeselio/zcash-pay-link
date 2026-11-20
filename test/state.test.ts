import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeState, defaultState, encodeState, MAX_RECIPIENTS, type FormState } from '../src/lib/state.ts';
import { EXAMPLE_T_TEST, EXAMPLE_Z_TEST } from '../src/lib/examples.ts';

test('form state round-trips through the URL fragment', () => {
  const state: FormState = {
    payments: [
      { address: EXAMPLE_Z_TEST, amount: '0.5', memo: 'Thanks ✨ & more=yes #1', label: 'Tip jar', message: 'a+b c%20d' },
      { address: '', amount: '', memo: '', label: '', message: '' },
      { address: EXAMPLE_T_TEST, amount: '1.', memo: '', label: '"><script>', message: '' },
    ],
    buttonText: 'Donate',
    includeQr: true,
  };
  const fragment = encodeState(state);
  assert.ok(!fragment.includes('#') && !fragment.includes(' '));
  assert.deepEqual(decodeState(fragment), state);
  assert.deepEqual(decodeState(`#${fragment}`), state);
});

test('the default state encodes to an empty fragment and back', () => {
  assert.equal(encodeState(defaultState()), '');
  assert.deepEqual(decodeState(''), defaultState());
});

test('malformed fragments fall back safely', () => {
  assert.deepEqual(decodeState('#n=abc&qr=yes'), defaultState());
  assert.equal(decodeState('n=-5').payments.length, 1);
  assert.equal(decodeState('n=100000').payments.length, MAX_RECIPIENTS);
  assert.equal(decodeState(`memo=${'x'.repeat(10_000)}`).payments[0]!.memo.length, 4096);
  assert.equal(decodeState('address=%E0%A4%A').payments[0]!.address.length > 0, true);
});
