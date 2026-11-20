import { escapeHtml } from './escape.ts';

export const DEFAULT_BUTTON_TEXT = 'Pay with Zcash';

export interface ButtonOptions {
  /** Button text. Defaults to "Pay with Zcash". */
  text?: string;
  /** Tooltip, e.g. "Pay Maya Lin Studio with Zcash". */
  title?: string;
  /** A QR code image (a `data:` URI) to show above the text. */
  qrDataUri?: string;
}

const FONT = 'font-family:system-ui,-apple-system,sans-serif;font-size:16px;font-weight:600;line-height:1.2;';
const COLORS = 'background:#f4b728;color:#1a1a1a;text-decoration:none;border:0;';

// A plain "Z" in a circle, so the button needs no external assets.
const MARK =
  '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="flex:none">' +
  '<circle cx="12" cy="12" r="11" fill="#1a1a1a"/>' +
  '<path d="M7.5 6.5h9v2.2l-6 6.6h6v2.2h-9v-2.2l6-6.6h-6z" fill="#f4b728"/></svg>';

/**
 * A self-contained "Pay with Zcash" link: one `<a href="zcash:…">` with inline styles and no
 * external assets. Every piece of text is HTML-escaped, so labels can't break out of it.
 */
export function buttonHtml(uri: string, options: ButtonOptions = {}): string {
  const text = options.text?.trim() || DEFAULT_BUTTON_TEXT;
  const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';
  const label = `<span style="display:inline-flex;align-items:center;gap:8px">${MARK}<span>${escapeHtml(text)}</span></span>`;
  if (!options.qrDataUri) {
    const style = `display:inline-flex;align-items:center;padding:12px 20px;border-radius:999px;${COLORS}${FONT}`;
    return `<a href="${escapeHtml(uri)}"${title} style="${style}">${label}</a>`;
  }
  const style = `display:inline-flex;flex-direction:column;align-items:center;gap:10px;padding:12px 12px 14px;border-radius:16px;${COLORS}${FONT}`;
  const img = `<img src="${escapeHtml(options.qrDataUri)}" width="176" height="176" alt="" style="display:block;border-radius:8px;background:#fff">`;
  return `<a href="${escapeHtml(uri)}"${title} style="${style}">${img}${label}</a>`;
}

/** Escapes Markdown punctuation in link text. */
export const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, '\\$&');

/**
 * A Markdown link. Parentheses in the URI (allowed in labels and messages) are percent-encoded
 * so they can't end the link early; the URI still means exactly the same payment.
 */
export function markdownLink(uri: string, text: string = DEFAULT_BUTTON_TEXT): string {
  const href = uri.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[${escapeMarkdown(text.trim() || DEFAULT_BUTTON_TEXT)}](${href})`;
}

/** Tooltip text for the button: "Pay Maya Lin Studio with Zcash" when there's one label. */
export function buttonTitle(labels: readonly (string | undefined)[]): string | undefined {
  const named = labels.filter((l): l is string => !!l);
  if (labels.length === 1 && named.length === 1) return `Pay ${named[0]} with Zcash`;
  return undefined;
}
