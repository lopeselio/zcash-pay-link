# zcash-pay-link

Make [ZIP-321](https://zips.z.cash/zip-0321) Zcash payment links, QR codes and "Pay with Zcash" buttons for a
donation page, tip jar or invoice. A static page that runs entirely in your browser.

**Live:** https://lopeselio.github.io/zcash-pay-link/

## Features

- One or more recipients in a single link (ZIP-321 multi-payment requests).
- Live checks as you type, using [zcash-zip321](https://github.com/lopeselio/zcash-zip321): every address is decoded and
  checksummed and described ("Unified Address · mainnet · Orchard + Sapling + transparent receivers"). Amounts are
  optional, with at most 8 decimals and 21,000,000 ZEC. Memos have a UTF-8 byte counter against the 512-byte limit.
- Warnings for transparent recipients (publicly visible) and test-network addresses. Mixing networks is an error, and
  the memo is turned off for addresses that can't receive one.
- Outputs, each with a Copy button: the `zcash:` URI, a QR code (download PNG or SVG), a self-contained HTML button with
  inline styles and an optional embedded QR code, and a Markdown link.
- The whole form is saved in the URL fragment, so you can bookmark a setup and come back to it.
- No server, analytics, fonts or CDNs. The built page has a Content Security Policy that blocks all network requests,
  and it never asks for keys.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # node --test on the pure modules in src/lib
npm run typecheck
npm run build      # static site in dist/
npm run check      # all of the above
```

Logic (validation, URI building, snippets, QR, URL state) lives in `src/lib` and is tested with `node --test`;
`src/main.ts` is the thin DOM layer. Pushes to `main` deploy to GitHub Pages.

MIT licensed. Built on [zcash-zip321](https://github.com/lopeselio/zcash-zip321).
