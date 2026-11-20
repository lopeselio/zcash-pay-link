import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEMO_BYTES, memoText, parsePaymentRequest } from 'zcash-zip321';
import { checkAmount, checkPayment, checkRequest, emptyPayment, utf8Length, type PaymentFields } from '../src/lib/validate.ts';
import { describeAddress } from '../src/lib/describe.ts';
import { decodeAddress } from 'zcash-zip321';
import {
  EXAMPLE_T_MAIN,
  EXAMPLE_T_TEST,
  EXAMPLE_UA,
  EXAMPLE_UA_ORCHARD,
  EXAMPLE_Z_TEST,
} from '../src/lib/examples.ts';

const row = (fields: Partial<PaymentFields>): PaymentFields => ({ ...emptyPayment(), ...fields });

test('describes addresses by kind, network and receivers', () => {
  assert.equal(describeAddress(decodeAddress(EXAMPLE_UA)), 'Unified Address · mainnet · Orchard + Sapling + transparent receivers');
  assert.equal(describeAddress(decodeAddress(EXAMPLE_UA_ORCHARD)), 'Unified Address · mainnet · Orchard receiver');
  assert.equal(describeAddress(decodeAddress(EXAMPLE_Z_TEST)), 'Sapling address · testnet');
  assert.equal(describeAddress(decodeAddress(EXAMPLE_T_TEST)), 'Transparent address · testnet or regtest');
});

test('a single payment round-trips through parsePaymentRequest', () => {
  const result = checkRequest([
    row({ address: ` ${EXAMPLE_UA} `, amount: '1.5', memo: 'order 42 ✨', label: 'Maya Lin Studio', message: 'Thanks & see you (soon)!' }),
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.network, 'main');
  assert.ok(result.uri?.startsWith(`zcash:${EXAMPLE_UA}?`));
  const { payments, network } = parsePaymentRequest(result.uri!);
  assert.equal(network, 'main');
  assert.equal(payments.length, 1);
  const [p] = payments;
  assert.equal(p!.address, EXAMPLE_UA);
  assert.equal(p!.amount, 150_000_000n);
  assert.equal(memoText(p!.memo!), 'order 42 ✨');
  assert.equal(p!.label, 'Maya Lin Studio');
  assert.equal(p!.message, 'Thanks & see you (soon)!');
});

test('an address alone is a valid request (the payer fills in the amount)', () => {
  const result = checkRequest([row({ address: EXAMPLE_UA_ORCHARD })]);
  assert.equal(result.uri, `zcash:${EXAMPLE_UA_ORCHARD}`);
  assert.equal(parsePaymentRequest(result.uri!).payments[0]!.amount, undefined);
});

test('several payments round-trip as a multi-payment request', () => {
  const result = checkRequest([
    row({ address: EXAMPLE_Z_TEST, amount: '0.789', memo: 'This is a unicode memo ✨🦄🏆🎉' }),
    row({ address: EXAMPLE_T_TEST, amount: '123.456', label: 'Second' }),
  ]);
  assert.equal(result.network, 'test');
  assert.ok(result.uri?.startsWith('zcash:?address='));
  const { payments } = parsePaymentRequest(result.uri!);
  assert.deepEqual(
    payments.map((p) => [p.index, p.address, p.amount, p.label]),
    [
      [0, EXAMPLE_Z_TEST, 78_900_000n, undefined],
      [1, EXAMPLE_T_TEST, 12_345_600_000n, 'Second'],
    ],
  );
  assert.equal(memoText(payments[0]!.memo!), 'This is a unicode memo ✨🦄🏆🎉');
});

test('amount validation', () => {
  assert.deepEqual(checkAmount(''), {});
  assert.deepEqual(checkAmount('   '), {});
  assert.deepEqual(checkAmount('1'), { zatoshi: 100_000_000n });
  assert.deepEqual(checkAmount('0.00000001'), { zatoshi: 1n });
  assert.deepEqual(checkAmount('.5'), { zatoshi: 50_000_000n });
  assert.deepEqual(checkAmount('2.'), { zatoshi: 200_000_000n });
  assert.deepEqual(checkAmount('0'), { zatoshi: 0n });
  assert.deepEqual(checkAmount('21000000'), { zatoshi: 2_100_000_000_000_000n });
  assert.deepEqual(checkAmount('20999999.99999999'), { zatoshi: 2_099_999_999_999_999n });
  assert.match(checkAmount('21000000.00000001').error!, /21,000,000/);
  assert.match(checkAmount('99999999999').error!, /21,000,000/);
  assert.match(checkAmount('0.000000001').error!, /8 decimal places/);
  assert.match(checkAmount('-1').error!, /negative/);
  assert.match(checkAmount('1,5').error!, /dot/);
  assert.match(checkAmount('1,000').error!, /thousands/);
  for (const bad of ['.', 'abc', '1e3', '0x10', '1.2.3', '+1', '1 000', 'Infinity', 'NaN']) {
    assert.ok(checkAmount(bad).error, `${bad} should be rejected`);
  }
});

test('a zero amount is allowed for shielded but not transparent recipients', () => {
  assert.ok(checkRequest([row({ address: EXAMPLE_Z_TEST, amount: '0' })]).uri);
  const t = checkRequest([row({ address: EXAMPLE_T_TEST, amount: '0' })]);
  assert.equal(t.uri, undefined);
  assert.match(t.payments[0]!.errors.amount!, /transparent/);
});

test('memo byte limit counts UTF-8 bytes, not characters', () => {
  assert.equal(utf8Length('é'), 2);
  assert.equal(utf8Length('🦄'), 4);
  const ok = 'a'.repeat(MAX_MEMO_BYTES);
  const okResult = checkRequest([row({ address: EXAMPLE_Z_TEST, memo: ok })]);
  assert.equal(okResult.payments[0]!.memoBytes, 512);
  assert.ok(okResult.uri);
  assert.equal(memoText(parsePaymentRequest(okResult.uri!).payments[0]!.memo!), ok);

  // 128 unicorns = 512 bytes; one more character pushes it over though there are only 129 characters.
  assert.ok(checkRequest([row({ address: EXAMPLE_Z_TEST, memo: '🦄'.repeat(128) })]).uri);
  const over = checkRequest([row({ address: EXAMPLE_Z_TEST, memo: `${'🦄'.repeat(128)}a` })]);
  assert.equal(over.payments[0]!.memoBytes, 513);
  assert.equal(over.uri, undefined);
  assert.match(over.payments[0]!.errors.memo!, /513 bytes; the limit is 512/);
  const accents = checkPayment(row({ address: EXAMPLE_Z_TEST, memo: 'é'.repeat(257) }));
  assert.equal(accents.memoBytes, 514);
  assert.ok(accents.errors.memo);
});

test('memo is disabled and left out for addresses that cannot receive one', () => {
  for (const address of [EXAMPLE_T_MAIN, EXAMPLE_T_TEST]) {
    const result = checkRequest([row({ address, amount: '1', memo: 'hello' })]);
    assert.equal(result.payments[0]!.memoAllowed, false);
    assert.equal(result.payments[0]!.errors.memo, undefined);
    assert.ok(result.uri);
    assert.ok(!result.uri!.includes('memo'));
    assert.equal(parsePaymentRequest(result.uri!).payments[0]!.memo, undefined);
  }
  // A too-long memo doesn't block a transparent payment, since it isn't sent.
  assert.ok(checkRequest([row({ address: EXAMPLE_T_MAIN, memo: 'x'.repeat(600) })]).uri);
  assert.equal(checkPayment(row({ address: EXAMPLE_UA })).memoAllowed, true);
});

test('warns about transparent and test-network recipients without blocking', () => {
  const t = checkRequest([row({ address: EXAMPLE_T_MAIN })]);
  assert.ok(t.uri);
  assert.equal(t.payments[0]!.warnings.length, 1);
  assert.match(t.payments[0]!.warnings[0]!, /publicly visible on chain/);

  const z = checkRequest([row({ address: EXAMPLE_Z_TEST })]);
  assert.ok(z.uri);
  assert.match(z.payments[0]!.warnings.join(' '), /only works with test networks/);

  const both = checkRequest([row({ address: EXAMPLE_T_TEST })]);
  assert.equal(both.payments[0]!.warnings.length, 2);
  assert.equal(both.network, undefined); // tm… addresses are valid on testnet and regtest

  assert.deepEqual(checkRequest([row({ address: EXAMPLE_UA })]).payments[0]!.warnings, []);
});

test('mixing networks is an error on the later recipient', () => {
  const result = checkRequest([row({ address: EXAMPLE_UA }), row({ address: EXAMPLE_Z_TEST })]);
  assert.equal(result.uri, undefined);
  assert.equal(result.payments[0]!.errors.address, undefined);
  assert.match(result.payments[1]!.errors.address!, /testnet address, but recipient 1 is on mainnet/);

  // A transparent test address narrows to testnet when paired with a testnet Sapling address.
  const ok = checkRequest([row({ address: EXAMPLE_T_TEST }), row({ address: EXAMPLE_Z_TEST })]);
  assert.ok(ok.uri);
  assert.equal(ok.network, 'test');
});

test('invalid and empty addresses', () => {
  const empty = checkRequest([emptyPayment()]);
  assert.equal(empty.empty, true);
  assert.equal(empty.uri, undefined);
  assert.equal(empty.payments[0]!.addressMissing, true);

  const typo = checkRequest([row({ address: `${EXAMPLE_UA.slice(0, -1)}q` })]);
  assert.match(typo.payments[0]!.errors.address!, /isn’t a valid Zcash address/);
  assert.equal(typo.uri, undefined);

  const blankSecond = checkRequest([row({ address: EXAMPLE_UA }), emptyPayment()]);
  assert.equal(blankSecond.empty, false);
  assert.match(blankSecond.payments[1]!.errors.address!, /remove this recipient/);
  assert.equal(blankSecond.uri, undefined);

  const amountOnly = checkRequest([row({ amount: '1' })]);
  assert.equal(amountOnly.empty, false);
  assert.ok(amountOnly.payments[0]!.errors.address);
});

test('whitespace-only label and message are left out', () => {
  const result = checkRequest([row({ address: EXAMPLE_UA, label: '   ', message: '\n' })]);
  assert.equal(result.uri, `zcash:${EXAMPLE_UA}`);
});
