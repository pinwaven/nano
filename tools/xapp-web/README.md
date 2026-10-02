# xapp-web — the uni-app x port, built for the browser

`src/xapp` is one source tree for native Android/iOS **and** a web (H5) build. This folder holds
the tooling for the web build. Its goal is to look and behave like the **web user-app**
(`src/web/user-app`). Nothing here is deployed. Architecture, styling model and verification:
[docs/architecture/xapp-web.md](../../docs/architecture/xapp-web.md).

## Build and serve

```bash
tools/xapp-web/build.sh                          # → src/xapp/unpackage/dist/build/web
node tools/xapp-web/serve.js --port 5180         # static + /api proxy → nano-dev
node tools/web-review/review.js http://localhost:5180/ --viewport mobile,desktop --user-token u.…
```

- **`build.sh`** runs HBuilderX's own compiler in build mode, with the same command and
  environment that `xcli launch web` spawns. It does not go through `xcli` directly, for two reasons:
  - `xcli publish web` needs a DCloud-registered `appid` (the manifest has none);
  - on Linux, `xcli launch web` stops its dev server as soon as the compile finishes.

  Needs `~/HBuilderX` (override with `HBX=`).
- **`serve.js`** serves the bundle and proxies `/api` to a backend. The web build calls the API
  same-origin (`BASE = ''` in `utils/config.uts` under `#ifdef WEB`). The worker's CORS preflight
  answers with two `Access-Control-Allow-Origin` values, which browsers reject, so a
  cross-origin build cannot call it directly.
- **`sync-css.mjs`** runs on every build and writes `src/xapp/static/web/user-app.css` (git-ignored).
  - It assembles the web user-app's stylesheet: its shell, theme tokens and `web-overrides.css`,
    plus the miniapp WXSS converted by the same rules as `user-app/scripts/sync-css-from-miniapp.mjs`.
  - It maps miniapp elements to uni's (`uni-view`, `uni-text`, …) instead of `div`/`span`.
  - It converts straight from the WXSS, not from `user-app/src/mini-css`, which is only as
    current as that app's last `npm run sync:css`.

## How the web build is styled

- `main.uts` (`#ifdef WEB`) loads `static/web/user-app.css` and `static/web/xapp-web.css`.
  `static/web/` is a web-only folder: the native build ignores it.
- The `<style>` blocks of the main page and its components, the login page and the full-screen
  pages are wrapped in `/* #ifndef WEB */`. On the web their markup (which uses the miniapp's
  class names) is styled by the user-app's CSS.
- `xapp-web.css` holds only the glue:
  - a reset back to WXML layout and inheritance (uni-app x makes every view a clipped flex column,
    and pins `font-size`/`text-align`/`letter-spacing` on every node);
  - tab and scroll-view plumbing, and the desktop phone frame (`.shell` / `.phone-frame`);
  - aliases for the xapp's flattened class names (uvue has no descendant selectors);
  - uni's own dialog, toast and action sheet restyled like the user-app's `ui-*`.
- Where the xapp's markup differed from the miniapp's, the page has a web-only template (`#ifdef WEB`):
  - `components/web-login`, the user-app's login screen (phone / email / WeChat QR, 中/EN, invite step);
  - `pages/phones`, `emails`, `referral`;
  - `pages/coach`, the miniapp's `coach.wxml` plus the user-app's coach-mode chat, refresh and
    appointment form.

## Web-only behaviour (all `#ifdef WEB`)

| What | Where | Why |
|---|---|---|
| GCN storefront opens in a new tab with a `wvt` | `utils/web-open.uts` | GCN refuses to be framed (`X-Frame-Options`) |
| QR scan: camera via `BarcodeDetector`, manual entry otherwise | `utils/web-ui.uts` `scanQr()` | `uni.scanCode` is an "unsupported" stub on web |
| Press-and-hold voice input (Web Speech) | `utils/web-speech.uts` | the user-app's `VoiceInput` |
| Image / document upload bytes via `fetch(blobURL)` | `utils/file-bytes.uts` | native file read is still a TODO |
| `uni.getWindowInfo()` clamped to the desktop frame | `main.uts` | width math assumed a phone |
| Theme / text-scale classes mirrored onto `<html>` | `utils/web-ui.uts` `syncRootClasses()` | the tokens live on `:root` |
| Email login on every channel; admin links open `/admin/` | `pages/main` | as in the user-app |

## Traps found the hard way

- Page code imports uni APIs as tree-shaken bindings. Reassigning `uni.showModal` (or any other
  API) on the global does nothing. Use a helper (`scanQr`) or CSS.
- `getStorageSync` of a missing key returns `''` on web (`null` on Android). `JSON.parse('')` throws.
- Arrays: `.length`, not Kotlin's `.size`. The latter is `undefined` on web, so every count read 0.
- Numeric ids: `UTSJSONObject.getString('id')` returns null for a number. Use `utils/json-id.uts`
  `idOf()`. This broke the coach panel on every platform.
- Running the Android compile (`xcli launch app-android --compile true`) together with headless
  browsers runs this 4 GB box out of memory. Run it alone.
