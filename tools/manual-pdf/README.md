# manual-pdf

Builds [`docs/user-manual/end-user-guide.pdf`](../../docs/user-manual/end-user-guide.pdf) from
[`end-user-guide.md`](../../docs/user-manual/end-user-guide.md) and the screenshots in
`docs/user-manual/images/`.

The markdown is the source of truth. **Re-run this whenever the guide changes**, or the PDF silently
goes stale against it.

```bash
tools/manual-pdf/build.sh
```

## What it does

| Stage | |
|---|---|
| `build.py` | markdown → `guide.html`, with the print stylesheet, a cover page and a generated TOC |
| `print.js` | `guide.html` → `_cover.pdf` + `_body.pdf` via headless Chrome over CDP |
| `merge.py` | joins the two into the final PDF and sets its metadata |

`build.sh` runs all three and deletes the intermediates.

## Requirements

Python `markdown` and `pypdf`, Node, and Google Chrome at `/Applications/Google Chrome.app`. The
`ws` module is borrowed from `tools/wechat-automator/node_modules` rather than vendored again — if
that tool's dependencies are ever pruned, `npm install ws` here instead.

## Why it's built this way

- **Two Chrome passes, then a merge.** Chrome's `--print-to-pdf` CLI flag cannot set a header or
  footer template, and CSS `@page` margin boxes (`@bottom-center { content: counter(page) }`) aren't
  supported either — so page numbers require driving Chrome over CDP and passing `footerTemplate`.
  That template can't be suppressed on a single page, so the cover prints in its own pass with
  `displayHeaderFooter: false` and the body prints from page 2 with the footer on.
- **The footer names its font explicitly.** Chrome renders header/footer templates in an isolated
  context that does not inherit the page's fonts; without a `font-family` it silently falls back to
  a serif that matches nothing else in the document.
- **Margins come from the CDP call, not CSS.** `@page` carries only `size: A4`, so the page margins
  and the footer stay in one place and can't disagree.
- **`build.py` exits non-zero on a missing image or a dead cross-link.** Both fail *silently* in
  Chrome — a missing screenshot prints as a blank box and a bad anchor as ordinary text — so they
  have to be caught before rendering.
- **Heading anchors must slugify identically under GitHub and python-markdown.** They disagree on
  punctuation: GitHub turns `Viva AG — Deep Analysis` into `viva-ag--deep-analysis` (two hyphens,
  the em dash dropped between them) while python-markdown collapses it to `viva-ag-deep-analysis`.
  Keep em dashes and other punctuation out of headings that anything links to — a colon slugifies
  the same way in both.
