import {
  decodeAddress,
  formatPaymentRequest,
  MAX_MEMO_BYTES,
  parseZec,
  ZIP321Error,
  type DecodedAddress,
  type Network,
  type PaymentInput,
} from 'zip321';
import { describeAddress, describeNetworks } from './describe.ts';

/** What the person typed for one recipient. Everything is a string, as in the form. */
export interface PaymentFields {
  address: string;
  amount: string;
  memo: string;
  label: string;
  message: string;
}

export type Field = keyof PaymentFields;

export const emptyPayment = (): PaymentFields => ({ address: '', amount: '', memo: '', label: '', message: '' });

export interface PaymentCheck {
  /** The decoded address, when it is valid. */
  address?: DecodedAddress;
  /** "Unified Address · mainnet · Orchard + Sapling + transparent receivers". */
  description?: string;
  /** Problems that stop a link being made, by field. */
  errors: Partial<Record<Field, string>>;
  /** True when the only problem with the address is that it is empty (show it once the field is touched). */
  addressMissing: boolean;
  /** Things worth knowing that don't stop the link (transparent recipient, test network). */
  warnings: string[];
  /** Whether this address can receive a memo. True until an address says otherwise. */
  memoAllowed: boolean;
  /** UTF-8 size of the memo text. */
  memoBytes: number;
  /** The payment for `formatPaymentRequest`, when this recipient has no errors. */
  input?: PaymentInput;
}

export interface RequestCheck {
  payments: PaymentCheck[];
  /** The `zcash:` URI, when every recipient is valid. */
  uri?: string;
  /** A problem with the request as a whole. */
  error?: string;
  /** The network all recipients share, when it is known. */
  network?: Network;
  /** True when nothing has been entered yet. */
  empty: boolean;
}

const NUMBER = /^(\d*)(?:\.(\d*))?$/;

/**
 * Checks a ZEC amount as typed. An empty amount is fine: ZIP-321 lets the payer fill it in.
 * Accepts `.5` and `1.` for convenience, and explains what is wrong otherwise.
 */
export function checkAmount(text: string): { zatoshi?: bigint; error?: string } {
  const value = text.trim();
  if (value === '') return {};
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value)) return { error: 'Leave out thousands separators, like 1000 instead of 1,000.' };
  if (value.includes(',')) return { error: 'Use a dot for decimals, like 0.5.' };
  const match = NUMBER.exec(value);
  if (!match || (match[1] === '' && !match[2])) {
    if (value.startsWith('-')) return { error: 'The amount can’t be negative.' };
    return { error: 'Enter an amount in ZEC, like 0.5.' };
  }
  if ((match[2] ?? '').length > 8) return { error: 'ZEC has at most 8 decimal places (0.00000001 is the smallest amount).' };
  const normalized = `${match[1] || '0'}${match[2] ? `.${match[2]}` : ''}`;
  try {
    return { zatoshi: parseZec(normalized) };
  } catch (err) {
    if (err instanceof ZIP321Error) return { error: 'The most you can request is 21,000,000 ZEC.' };
    throw err;
  }
}

/** UTF-8 byte length, which is what the 512-byte memo limit counts. */
export const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

const isEmpty = (p: PaymentFields) => Object.values(p).every((v) => v.trim() === '');

/** Checks one recipient on its own (network mixing is checked across the request). */
export function checkPayment(fields: PaymentFields, options: { multiple?: boolean } = {}): PaymentCheck {
  const check: PaymentCheck = {
    errors: {},
    addressMissing: false,
    warnings: [],
    memoAllowed: true,
    memoBytes: utf8Length(fields.memo),
  };

  const address = fields.address.trim();
  if (address === '') {
    check.addressMissing = true;
    check.errors.address = options.multiple && isEmpty(fields)
      ? 'Enter an address, or remove this recipient.'
      : 'Enter the Zcash address that should receive this payment.';
  } else {
    try {
      check.address = decodeAddress(address);
      check.description = describeAddress(check.address);
    } catch (err) {
      if (!(err instanceof ZIP321Error)) throw err;
      check.errors.address = err.code === 'UNSUPPORTED_ADDRESS'
        ? 'Sprout addresses can’t be used in payment links. Use a Unified or Sapling address.'
        : 'This isn’t a valid Zcash address. Check that it was copied in full.';
    }
  }

  const info = check.address;
  if (info) {
    if (info.transparentOnly) {
      check.warnings.push('Payments to this address are publicly visible on chain. A shielded (Unified or Sapling) address keeps them private.');
    }
    if (!info.networks.includes('main')) {
      check.warnings.push(`This is a ${describeNetworks(info.networks)} address, so this link only works with test networks.`);
    }
    check.memoAllowed = info.canReceiveMemo;
  }

  const amount = checkAmount(fields.amount);
  if (amount.error) check.errors.amount = amount.error;
  else if (amount.zatoshi === 0n && info?.transparentOnly) {
    check.errors.amount = 'A payment to a transparent address can’t be 0 ZEC. Leave it empty to let the payer choose.';
  }

  const includeMemo = check.memoAllowed && fields.memo !== '';
  if (includeMemo && check.memoBytes > MAX_MEMO_BYTES) {
    check.errors.memo = `The memo is ${check.memoBytes} bytes; the limit is ${MAX_MEMO_BYTES}.`;
  }

  if (Object.keys(check.errors).length === 0 && info) {
    const input: PaymentInput = { address };
    if (amount.zatoshi !== undefined) input.amount = amount.zatoshi;
    if (includeMemo) input.memo = fields.memo;
    const label = fields.label.trim();
    const message = fields.message.trim();
    if (label) input.label = label;
    if (message) input.message = message;
    check.input = input;
  }
  return check;
}

/** Checks the whole form and, when it is valid, builds the `zcash:` URI. */
export function checkRequest(rows: readonly PaymentFields[]): RequestCheck {
  const empty = rows.length === 0 || (rows.length === 1 && isEmpty(rows[0]!));
  const payments = rows.map((row) => checkPayment(row, { multiple: rows.length > 1 }));
  const result: RequestCheck = { payments, empty };
  if (empty) return result;

  // Every recipient has to be on the same network.
  let possible: readonly Network[] = ['main', 'test', 'regtest'];
  let first = -1;
  payments.forEach((p, i) => {
    if (!p.address) return;
    const next = possible.filter((n) => p.address!.networks.includes(n));
    if (next.length === 0) {
      const other = payments[first]!.address!;
      p.errors.address = `This is a ${describeNetworks(p.address.networks)} address, but recipient ${first + 1} is on ${describeNetworks(other.networks)}. All recipients must be on the same network.`;
      delete p.input;
      return;
    }
    if (first === -1) first = i;
    possible = next;
  });
  if (first !== -1 && possible.length === 1) result.network = possible[0];

  if (payments.every((p) => p.input)) {
    try {
      result.uri = formatPaymentRequest(payments.map((p) => p.input!));
    } catch (err) {
      if (!(err instanceof ZIP321Error)) throw err;
      result.error = `This payment request isn’t valid: ${err.message}`;
    }
  }
  return result;
}
