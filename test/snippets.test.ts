import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentRequest } from 'zcash-zip321';
import { buttonHtml, buttonTitle, escapeMarkdown, markdownLink } from '../src/lib/snippets.ts';
import { escapeHtml } from '../src/lib/escape.ts';
import { checkRequest, emptyPayment } from '../src/lib/validate.ts';
import { qrMatrix, qrSvg, svgDataUri } from '../src/lib/qr.ts';
import { EXAMPLE_UA } from '../src/lib/examples.ts';

const EVIL = `"><script>alert(1)</script><img src=x onerror=alert(2)>'`;

const uriFor = (fields: Partial<ReturnType<typeof emptyPayment>>) => {
  const { uri } = checkRequest([{ ...emptyPayment(), address: EXAMPLE_UA, ...fields }]);
  assert.ok(uri);
  return uri!;
};

/** Every attribute value is double-quoted and no quote inside one is raw. */
function assertNoBreakout(html: string) {
  assert.ok(!/<script/i.test(html), 'no <script> tag');
  assert.ok(!/<img[^>]*onerror/i.test(html), 'no injected handler');
  // Strip the known-good tags; nothing executable or unexpected may remain.
  const tags = html.match(/<\/?([a-z]+)/gi)!.map((t) => t.replace(/[</]/g, '').toLowerCase());
  for (const tag of tags) assert.ok(['a', 'span', 'svg', 'circle', 'path', 'img'].includes(tag), `unexpected tag ${tag}`);
  // Attributes: name="value" with no raw quote or angle bracket inside values.
  for (const [, value] of html.matchAll(/="([^"]*)"/g)) assert.ok(!/[<>]/.test(value!), `raw < or > in attribute: ${value}`);
}

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('a hostile label cannot break out of the button snippet', () => {
  const uri = uriFor({ label: EVIL, message: EVIL });
  const html = buttonHtml(uri, { text: EVIL, title: buttonTitle([EVIL]) });
  assertNoBreakout(html);
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), 'button text is escaped, not dropped');
  assert.equal(html.match(/<a /g)!.length, 1);
  assert.ok(html.endsWith('</a>'));
});

test('the button href is the exact URI and still parses after HTML decoding', () => {
  const uri = uriFor({ amount: '0.5', label: `Tom's "Café" & Bar`, message: EVIL });
  const html = buttonHtml(uri);
  const href = /href="([^"]*)"/.exec(html)![1]!;
  const decoded = href.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(decoded, uri);
  const [p] = parsePaymentRequest(decoded).payments;
  assert.equal(p!.label, `Tom's "Café" & Bar`);
  assert.equal(p!.message, EVIL);
  assert.ok(html.includes('&amp;label='), 'parameter separators are escaped as &amp;');
});

test('the button uses inline styles only and the default text', () => {
  const html = buttonHtml(uriFor({}));
  assert.ok(html.startsWith('<a href="zcash:'));
  assert.ok(html.includes('>Pay with Zcash<'));
  assert.ok(!/<link|<style|url\(|https?:/i.test(html.replace('http://www.w3.org/2000/svg', '')), 'no external assets');
});

test('the button can carry the QR code as a data: URI image', () => {
  const uri = uriFor({ amount: '1' });
  const svg = qrSvg(qrMatrix(uri));
  const html = buttonHtml(uri, { qrDataUri: svgDataUri(svg), title: buttonTitle(['Shop']) });
  assert.match(html, /<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  assert.ok(html.includes('title="Pay Shop with Zcash"'));
  const b64 = /base64,([^"]+)/.exec(html)![1]!;
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), svg);
});

test('Markdown link escapes its text and keeps parentheses from ending the link', () => {
  const uri = uriFor({ label: 'Tips (thanks!)' });
  assert.ok(uri.includes('(thanks!)'));
  const md = markdownLink(uri, 'Tip [me]');
  assert.ok(md.startsWith('[Tip \\[me\\]](zcash:'));
  const href = /\]\((.*)\)$/.exec(md)![1]!;
  assert.ok(!/[()]/.test(href));
  assert.equal(parsePaymentRequest(href).payments[0]!.label, 'Tips (thanks!)');
  assert.equal(markdownLink(`zcash:${EXAMPLE_UA}`), `[Pay with Zcash](zcash:${EXAMPLE_UA})`);
  assert.equal(escapeMarkdown('*_`'), '\\*\\_\\`');
});

test('button title only names a single labelled recipient', () => {
  assert.equal(buttonTitle(['Shop']), 'Pay Shop with Zcash');
  assert.equal(buttonTitle([undefined]), undefined);
  assert.equal(buttonTitle(['A', 'B']), undefined);
});
