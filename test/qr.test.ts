import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg, QrTooLongError } from '../src/lib/qr.ts';
import { EXAMPLE_UA } from '../src/lib/examples.ts';

test('encodes a URI as a square QR matrix with finder patterns', () => {
  const m = qrMatrix(`zcash:${EXAMPLE_UA}?amount=1`);
  assert.ok(m.size >= 21 && (m.size - 17) % 4 === 0);
  // Top-left finder pattern: a dark 7x7 ring.
  for (let i = 0; i < 7; i++) {
    assert.ok(m.isDark(0, i) && m.isDark(6, i) && m.isDark(i, 0) && m.isDark(i, 6));
  }
  assert.ok(!m.isDark(1, 1));
});

test('renders an SVG with a quiet zone, and escapes its title', () => {
  const m = qrMatrix('zcash:test');
  const svg = qrSvg(m, { title: 'Pay <Shop> "now"', pixels: 200 });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`));
  assert.ok(svg.includes('width="200"'));
  assert.ok(svg.includes('<title>Pay &lt;Shop&gt; &quot;now&quot;</title>'));
  assert.match(svg, /<path fill="#000000" d="(M\d+ \d+h\d+v1h-\d+z)+"\/><\/svg>$/);
});

test('text too long for any QR code gives a friendly error', () => {
  assert.throws(() => qrMatrix('x'.repeat(5000)), QrTooLongError);
});
