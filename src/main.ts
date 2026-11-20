import './style.css';
import { MAX_MEMO_BYTES } from 'zcash-zip321';
import { EXAMPLE_UA } from './lib/examples.ts';
import { qrMatrix, qrSvg, svgDataUri, QrTooLongError, type QrMatrix } from './lib/qr.ts';
import { buttonHtml, buttonTitle, markdownLink } from './lib/snippets.ts';
import { decodeState, defaultState, encodeState, MAX_RECIPIENTS, type FormState } from './lib/state.ts';
import { checkRequest, emptyPayment, type Field, type PaymentCheck, type RequestCheck } from './lib/validate.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  payments: $('payments'),
  add: $<HTMLButtonElement>('add'),
  example: $<HTMLButtonElement>('example'),
  reset: $<HTMLButtonElement>('reset'),
  buttonText: $<HTMLInputElement>('button-text'),
  includeQr: $<HTMLInputElement>('include-qr'),
  status: $('status'),
  results: $('results'),
  uri: $('uri'),
  openWallet: $<HTMLAnchorElement>('open-wallet'),
  qr: $('qr'),
  qrError: $('qr-error'),
  downloadPng: $<HTMLButtonElement>('download-png'),
  downloadSvg: $<HTMLButtonElement>('download-svg'),
  preview: $('button-preview'),
  buttonHtml: $<HTMLTextAreaElement>('button-html'),
  markdown: $('markdown'),
  copySetup: $<HTMLButtonElement>('copy-setup'),
  announcer: $('announcer'),
};

let state: FormState = defaultState();
/** Fields the person has finished with (blurred, pasted into, or restored), so it's fair to show "required" errors. */
let touched = new Set<string>();
let current: { uri?: string; matrix?: QrMatrix } = {};
let lastHash = '';

// ---------------------------------------------------------------------------------------------
// Recipient rows

interface FieldSpec {
  field: Field;
  label: string;
  hint: string;
  multiline?: boolean;
  attrs?: Record<string, string>;
}

const FIELDS: FieldSpec[] = [
  {
    field: 'address',
    label: 'Zcash address',
    hint: 'Your receiving address: a Unified Address (u1…) is best. Sapling (zs1…) and transparent (t1…) work too.',
    multiline: true,
    attrs: { rows: '3', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' },
  },
  {
    field: 'amount',
    label: 'Amount in ZEC',
    hint: 'Optional. Leave it empty to let the payer choose, as in a tip jar.',
    attrs: { inputmode: 'decimal', autocomplete: 'off', placeholder: 'e.g. 0.5' },
  },
  {
    field: 'memo',
    label: 'Memo',
    hint: 'Optional. A private note that arrives with the payment, such as an invoice number.',
    multiline: true,
    attrs: { rows: '2' },
  },
  {
    field: 'label',
    label: 'Recipient name',
    hint: 'Optional. Shown in the payer’s wallet, such as your name or shop.',
    attrs: { autocomplete: 'off' },
  },
  {
    field: 'message',
    label: 'Message to the payer',
    hint: 'Optional. For example “Thanks for supporting my work!”',
    attrs: { autocomplete: 'off' },
  },
];

const fieldId = (i: number, field: Field) => `p${i}-${field}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function renderRows() {
  els.payments.replaceChildren(...state.payments.map((payment, i) => {
    const fieldset = el('fieldset', { className: 'recipient' });
    const legend = el('legend', {}, state.payments.length > 1 ? `Recipient ${i + 1}` : 'Recipient');
    fieldset.append(legend);
    if (state.payments.length > 1) {
      const remove = el('button', { type: 'button', className: 'btn btn-quiet btn-small remove', textContent: 'Remove' });
      remove.setAttribute('aria-label', `Remove recipient ${i + 1}`);
      remove.addEventListener('click', () => removeRow(i));
      fieldset.append(remove);
    }
    for (const spec of FIELDS) {
      const id = fieldId(i, spec.field);
      const input = spec.multiline ? el('textarea', { id }) : el('input', { id, type: 'text' });
      for (const [k, v] of Object.entries(spec.attrs ?? {})) input.setAttribute(k, v);
      input.value = payment[spec.field];
      input.dataset.index = String(i);
      input.dataset.field = spec.field;

      const control = spec.field === 'amount'
        ? el('div', { className: 'with-suffix' }, input, el('span', { className: 'suffix', ariaHidden: 'true' }, 'ZEC'))
        : input;
      const extra: HTMLElement[] = [];
      if (spec.field === 'address') extra.push(el('p', { id: `${id}-info`, className: 'address-info' }));
      if (spec.field === 'memo') {
        extra.push(el('p', { id: `${id}-count`, className: 'counter' }));
        extra.push(el('p', { id: `${id}-note`, className: 'message note', hidden: true }));
      }
      fieldset.append(el('div', { className: `field field-${spec.field}` },
        el('label', { htmlFor: id }, spec.label),
        control,
        el('p', { id: `${id}-hint`, className: 'hint' }, spec.hint),
        ...extra,
        el('p', { id: `${id}-error`, className: 'message error', hidden: true }),
        el('ul', { id: `${id}-warnings`, className: 'message warning', hidden: true }),
      ));
    }
    return fieldset;
  }));
  els.add.disabled = state.payments.length >= MAX_RECIPIENTS;
}

function addRow() {
  state.payments.push(emptyPayment());
  renderRows();
  update();
  $(fieldId(state.payments.length - 1, 'address')).focus();
}

function removeRow(index: number) {
  state.payments.splice(index, 1);
  // Shift "touched" marks down so errors stay on the right rows.
  touched = new Set([...touched].flatMap((key) => {
    const [i, field] = key.split(':') as [string, string];
    const n = Number(i);
    return n === index ? [] : [`${n > index ? n - 1 : n}:${field}`];
  }));
  renderRows();
  update();
  announce(`Recipient ${index + 1} removed.`);
  const next = Math.min(index, state.payments.length - 1);
  $(fieldId(next, 'address')).focus();
}

// ---------------------------------------------------------------------------------------------
// Messages beside each field

function showMessages(check: PaymentCheck, i: number) {
  for (const { field } of FIELDS) {
    const id = fieldId(i, field);
    const input = $<HTMLInputElement | HTMLTextAreaElement>(id);
    let error = check.errors[field];
    // Address errors wait until typing looks finished (blur or paste); the others are precise enough to show live.
    if (field === 'address' && !touched.has(`${i}:address`)) error = undefined;

    const errorEl = $(`${id}-error`);
    errorEl.textContent = error ?? '';
    errorEl.hidden = !error;
    input.setAttribute('aria-invalid', String(!!error));

    const describedBy = [`${id}-hint`];
    if (field === 'address') {
      const info = $(`${id}-info`);
      info.textContent = check.description ? `${check.errors.address ? '' : '✓ '}${check.description}` : '';
      info.hidden = !check.description;
      if (check.description) describedBy.push(`${id}-info`);
      const warnings = $(`${id}-warnings`);
      warnings.replaceChildren(...check.warnings.map((w) => el('li', {}, w)));
      warnings.hidden = check.warnings.length === 0;
      if (check.warnings.length) describedBy.push(`${id}-warnings`);
    }
    if (field === 'memo') {
      input.disabled = !check.memoAllowed;
      const count = $(`${id}-count`);
      count.textContent = `${check.memoBytes} / ${MAX_MEMO_BYTES} bytes`;
      count.classList.toggle('over', check.memoBytes > MAX_MEMO_BYTES);
      count.hidden = !check.memoAllowed;
      const note = $(`${id}-note`);
      note.hidden = check.memoAllowed;
      note.textContent = check.memoAllowed
        ? ''
        : `Transparent addresses can’t receive memos${state.payments[i]!.memo ? ', so this memo won’t be included' : ''}. Use a shielded address to add one.`;
      describedBy.push(check.memoAllowed ? `${id}-count` : `${id}-note`);
    }
    if (error) describedBy.push(`${id}-error`);
    input.setAttribute('aria-describedby', describedBy.join(' '));
  }
}

// ---------------------------------------------------------------------------------------------
// Outputs

function update() {
  const result = checkRequest(state.payments);
  result.payments.forEach(showMessages);
  showOutputs(result);
  saveHash();
}

function setStatus(text: string) {
  if (els.status.textContent !== text) els.status.textContent = text;
}

function showOutputs(result: RequestCheck) {
  if (!result.uri) {
    current = {};
    els.results.hidden = true;
    els.status.classList.toggle('error', !!result.error);
    setStatus(result.empty
      ? 'Enter a Zcash address to get started.'
      : result.error ?? 'Fix the highlighted fields to see your link.');
    return;
  }
  els.status.classList.remove('error');
  setStatus(result.network && result.network !== 'main'
    ? `Your link is ready. It’s for ${result.network === 'test' ? 'testnet' : 'regtest'}, so real wallets on mainnet won’t pay it.`
    : 'Your link is ready.');
  els.results.hidden = false;
  if (current.uri === result.uri && els.buttonHtml.dataset.options === buttonOptionsKey()) return;

  const uri = result.uri;
  els.uri.textContent = uri;
  els.openWallet.href = uri;

  let matrix: QrMatrix | undefined;
  try {
    matrix = qrMatrix(uri);
  } catch (err) {
    if (!(err instanceof QrTooLongError)) throw err;
    els.qrError.textContent = err.message;
  }
  current = { uri, matrix };
  els.qrError.hidden = !!matrix;
  els.qr.hidden = !matrix;
  els.downloadPng.disabled = els.downloadSvg.disabled = !matrix;
  els.qr.innerHTML = matrix ? qrSvg(matrix, { title: 'QR code for this Zcash payment link' }) : '';

  const labels = state.payments.map((p) => p.label.trim() || undefined);
  const html = buttonHtml(uri, {
    text: state.buttonText,
    title: buttonTitle(labels),
    qrDataUri: state.includeQr && matrix ? svgDataUri(qrSvg(matrix)) : undefined,
  });
  // `html` is built from escaped text only (see test/snippets.test.ts), so it is safe to render.
  els.preview.innerHTML = html;
  els.buttonHtml.value = html;
  els.buttonHtml.dataset.options = buttonOptionsKey();
  els.markdown.textContent = markdownLink(uri, state.buttonText);
}

const buttonOptionsKey = () => JSON.stringify([state.buttonText, state.includeQr]);

// ---------------------------------------------------------------------------------------------
// URL fragment state

function saveHash() {
  const hash = encodeState(state);
  if (hash === lastHash) return;
  lastHash = hash;
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

function loadHash() {
  const hash = location.hash.slice(1);
  if (hash === lastHash) return;
  lastHash = hash;
  state = decodeState(hash);
  // Restored fields count as finished, so their errors show straight away.
  touched = new Set(state.payments.flatMap((p, i) => (p.address ? [`${i}:address`] : [])));
  els.buttonText.value = state.buttonText;
  els.includeQr.checked = state.includeQr;
  renderRows();
  update();
}

// ---------------------------------------------------------------------------------------------
// Copy and download

function announce(text: string) {
  els.announcer.textContent = '';
  // A fresh text node makes screen readers repeat the same message.
  requestAnimationFrame(() => (els.announcer.textContent = text));
}

async function copy(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el('textarea', { value: text });
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) {
      announce('Couldn’t copy. Select the text and copy it yourself.');
      return;
    }
  }
  const original = button.dataset.label ?? button.textContent ?? 'Copy';
  button.dataset.label = original;
  button.textContent = 'Copied';
  announce('Copied to the clipboard.');
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => (button.textContent = original), 2000));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPng(matrix: QrMatrix) {
  const margin = 4;
  const scale = 12;
  const total = (matrix.size + margin * 2) * scale;
  const canvas = el('canvas', { width: total, height: total });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.isDark(row, col)) ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
    }
  }
  canvas.toBlob((blob) => blob && download(blob, 'zcash-payment-qr.png'), 'image/png');
}

// ---------------------------------------------------------------------------------------------
// Events

els.payments.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  const { index, field } = input.dataset;
  if (index === undefined || !field) return;
  state.payments[Number(index)]![field as Field] = input.value;
  if ((event as InputEvent).inputType === 'insertFromPaste' || (event as InputEvent).inputType === 'insertFromDrop') {
    touched.add(`${index}:${field}`);
  }
  update();
});

els.payments.addEventListener('focusout', (event) => {
  const input = event.target as HTMLElement;
  const { index, field } = input.dataset;
  if (index === undefined || !field) return;
  const key = `${index}:${field}`;
  if (touched.has(key)) return;
  touched.add(key);
  update();
});

els.add.addEventListener('click', addRow);

els.buttonText.addEventListener('input', () => {
  state.buttonText = els.buttonText.value;
  update();
});

els.includeQr.addEventListener('change', () => {
  state.includeQr = els.includeQr.checked;
  update();
});

els.example.addEventListener('click', () => {
  state = {
    payments: [{
      address: EXAMPLE_UA,
      amount: '',
      memo: 'Thanks for the coffee!',
      label: 'Example Coffee Fund',
      message: 'Example only: replace the address with your own',
    }],
    buttonText: 'Tip with Zcash',
    includeQr: true,
  };
  touched = new Set(['0:address']);
  els.buttonText.value = state.buttonText;
  els.includeQr.checked = state.includeQr;
  renderRows();
  update();
  announce('Filled in an example using a public test-vector address. Replace it with your own address.');
});

els.reset.addEventListener('click', () => {
  state = defaultState();
  touched = new Set();
  els.buttonText.value = '';
  els.includeQr.checked = false;
  renderRows();
  update();
  $(fieldId(0, 'address')).focus();
  announce('Form cleared.');
});

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => {
    const source = $(button.dataset.copy!);
    void copy(source instanceof HTMLTextAreaElement ? source.value : source.textContent ?? '', button);
  });
});

els.copySetup.addEventListener('click', () => void copy(location.href, els.copySetup));

els.downloadSvg.addEventListener('click', () => {
  if (current.matrix) download(new Blob([qrSvg(current.matrix)], { type: 'image/svg+xml' }), 'zcash-payment-qr.svg');
});

els.downloadPng.addEventListener('click', () => {
  if (current.matrix) downloadPng(current.matrix);
});

window.addEventListener('hashchange', loadHash);

lastHash = '\u0000'; // force the first load
loadHash();
