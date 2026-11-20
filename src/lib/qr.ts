import QRCode from 'qrcode';
import { escapeHtml } from './escape.ts';

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  isDark(row: number, col: number): boolean;
}

/** Thrown when the text is too long to fit in any QR code. */
export class QrTooLongError extends Error {
  override name = 'QrTooLongError';
}

/** Encodes text as a QR code (error correction M, which wallets scan reliably from screens and paper). */
export function qrMatrix(text: string): QrMatrix {
  let qr: QRCode.QRCode;
  try {
    qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  } catch (err) {
    if (err instanceof Error && /too big|amount of data/i.test(err.message)) {
      throw new QrTooLongError('This link is too long for a QR code. Shorten the memo, label or message, or use fewer recipients.');
    }
    throw err;
  }
  const { size, data } = qr.modules;
  return { size, isDark: (row, col) => data[row * size + col] === 1 };
}

export interface QrSvgOptions {
  /** Quiet zone in modules (the QR spec asks for 4). */
  margin?: number;
  /** Rendered width and height in px. Omitted, the SVG scales to its container. */
  pixels?: number;
  dark?: string;
  light?: string;
  /** Accessible name, written as `<title>`. */
  title?: string;
}

/** Renders a QR matrix as a compact, self-contained SVG: one path, one run per row segment. */
export function qrSvg(matrix: QrMatrix, options: QrSvgOptions = {}): string {
  const { margin = 4, pixels, dark = '#000000', light = '#ffffff', title } = options;
  const total = matrix.size + margin * 2;
  let d = '';
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      d += `M${start + margin} ${row + margin}h${col - start}v1h${start - col}z`;
    }
  }
  const size = pixels ? ` width="${pixels}" height="${pixels}"` : '';
  const label = title ? ` role="img" aria-label="${escapeHtml(title)}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${size}${label} shape-rendering="crispEdges">` +
    (title ? `<title>${escapeHtml(title)}</title>` : '') +
    `<rect width="${total}" height="${total}" fill="${escapeHtml(light)}"/>` +
    `<path fill="${escapeHtml(dark)}" d="${d}"/></svg>`
  );
}

/** A `data:` URI for an SVG, safe to put in an attribute. */
export function svgDataUri(svg: string): string {
  // The SVG we make is ASCII except for a user-supplied title, so encode via UTF-8 first.
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
