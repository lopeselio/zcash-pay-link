import { emptyPayment, type Field, type PaymentFields } from './validate.ts';

/** Everything on the form, so a creator can bookmark their setup. */
export interface FormState {
  payments: PaymentFields[];
  buttonText: string;
  includeQr: boolean;
}

export const MAX_RECIPIENTS = 20;
const MAX_FIELD_LENGTH = 4096;
const FIELDS: readonly Field[] = ['address', 'amount', 'memo', 'label', 'message'];

export const defaultState = (): FormState => ({ payments: [emptyPayment()], buttonText: '', includeQr: false });

const key = (field: string, index: number) => (index === 0 ? field : `${field}.${index}`);

/**
 * Writes form state as a URL fragment (without the `#`), e.g.
 * `address=u1…&amount=0.5&n=2&address.1=zs1…`. Empty fields are left out. The fragment never
 * reaches a server, so nothing typed here leaves the browser.
 */
export function encodeState(state: FormState): string {
  const params = new URLSearchParams();
  if (state.payments.length > 1) params.set('n', String(state.payments.length));
  state.payments.forEach((payment, i) => {
    for (const field of FIELDS) if (payment[field] !== '') params.set(key(field, i), payment[field]);
  });
  if (state.buttonText !== '') params.set('button', state.buttonText);
  if (state.includeQr) params.set('qr', '1');
  return params.toString();
}

/** Reads state written by `encodeState`. Anything malformed falls back to an empty form. */
export function decodeState(fragment: string): FormState {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const state = defaultState();
  const n = Number(params.get('n') ?? '1');
  const count = Number.isInteger(n) ? Math.min(Math.max(n, 1), MAX_RECIPIENTS) : 1;
  const get = (name: string) => (params.get(name) ?? '').slice(0, MAX_FIELD_LENGTH);
  state.payments = Array.from({ length: count }, (_, i) => {
    const payment = emptyPayment();
    for (const field of FIELDS) payment[field] = get(key(field, i));
    return payment;
  });
  state.buttonText = get('button').slice(0, 100);
  state.includeQr = params.get('qr') === '1';
  return state;
}
