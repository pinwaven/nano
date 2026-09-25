# web-review

Headless [Playwright](https://playwright.dev) review of the web user-app and admin panel, for
the EC2 dev box, which has no display, no Chrome, no fonts and no passwordless `sudo`. It saves
screenshots per viewport plus every console error, uncaught exception and failed or 4xx/5xx
request. Claude reads the PNGs directly. A human can `scp` them, or open a trace locally.

## Setup (once per machine)

```bash
bash tools/web-review/setup.sh
```

This runs `npm install`, downloads Playwright's Chromium, and then fetches the system libraries
and fonts Chromium needs as `.deb` files. They're unpacked with `apt-get download` + `dpkg-deb -x`
into `~/.local/chromium-libs` (override with `WEB_REVIEW_LIBS`), so no root is needed and nothing
touches the system. It finishes with `--selftest`.

`browser.js`'s `launch()` points Chromium at those libraries and fonts through `LD_LIBRARY_PATH` /
`FONTCONFIG_FILE`. **Always launch through it.** A plain `chromium.launch()` on this box either
fails with a missing `.so` file or renders every page blank (no fonts).

## Usage

```bash
# user-app dev server (vite's `open: true` logs a harmless `spawn xdg-open ENOENT`)
(cd src/web/user-app && npx vite --port 5178) &
node tools/web-review/review.js http://localhost:5178/ --viewport mobile,desktop

# logged in: user-app reads localStorage nano_session, admin panel sessionStorage nano_admin_token
node tools/web-review/review.js http://localhost:5178/ --user-token u.xxxxx
node tools/web-review/review.js http://localhost:5176/admin/ --viewport desktop --admin-token xxxxx
```

| Option | |
|---|---|
| `--viewport mobile,desktop` | `mobile` (iPhone 13) · `android` (Pixel 7) · `tablet` · `desktop` (1440×900). Default `mobile` |
| `--full` | full-page screenshots |
| `--user-token` / `--admin-token` | session injection (see above) |
| `--local k=v` / `--session k=v` | any other storage entry. Written by an init script, so it exists before the app's first read |
| `--wait-for <sel>` / `--wait <ms>` | settle before the first shot (default 1500 ms) |
| `--steps file.json` | scripted actions, below |
| `--trace` | writes `<viewport>-trace.zip`. Copy it to a laptop and run `npx playwright show-trace` |
| `--out <dir>` | default `temp/web-review/<timestamp>/` (git-ignored) |

The page runs with `zh-CN` locale and `Asia/Shanghai` timezone. Output is PNGs +
`report.json`. The exit code is 1 if navigation or a step failed. Console errors don't change
the exit code; they're reported only.

### Steps

```json
[
  {"click": "text=中"},
  {"fill": ["input[type=tel]", "13800000000"]},
  {"press": "Enter"},
  {"waitFor": "role=button[name=\"发送\"]"},
  {"wait": 500},
  {"scroll": "bottom"},
  {"shot": "after-login"},
  {"eval": "document.title"}
]
```

Selectors are Playwright's (`text=`, `role=`, CSS). If no step takes a `shot`, a final `end`
screenshot is taken.

### In your own script

```js
const { launch, VIEWPORTS, collectIssues } = require('./tools/web-review/browser');
const browser = await launch();
const page = await (await browser.newContext(VIEWPORTS.mobile)).newPage();
```

## Gotchas

- `libgallium` (Mesa) is deliberately left unresolved: only the optional GPU backend loads it,
  and headless Chromium renders in software without it.
- Only the fonts in `setup.sh` exist. `PingFang SC`, `Microsoft YaHei`, `-apple-system` and
  `system-ui` are aliased to Noto Sans CJK / DejaVu, so text *metrics* differ slightly from a
  real iPhone. Check layouts that depend on exact text width on a device.
- The dev servers proxy `/api` to **dev** (`nano-dev.gcn.net`), so a logged-in review reads and
  writes dev data.
