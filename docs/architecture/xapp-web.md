# xapp web — the uni-app x port as an HTML5 app

`src/xapp` (the uni-app x port of the miniapp, [xapp-uniapp-port.md](xapp-uniapp-port.md)) also
builds for the browser. The goal of that build: **contain everything the web user-app
(`src/web/user-app`) can do, and look identical to it.** Started 2026-10-01 (xapp VERSION
`1001-8`). Like the rest of the xapp it is a trial: **nothing is deployed**, and the web user-app
stays the production web client.

Runbook (build / serve / review commands): [tools/xapp-web/README.md](../../tools/xapp-web/README.md).

---

## 1. Why this shape

There are three clients descended from one source of truth, the miniapp:

| Client | Markup | Styles |
|---|---|---|
| miniapp | WXML | WXSS |
| web user-app | React JSX mirroring the WXML, same class names | CSS **generated from the WXSS** (`sync-css-from-miniapp.mjs`) + a web shell (`style.css`, `web-overrides.css`) |
| xapp | uvue templates ported from the WXML, mostly the same class names | hand-tuned uvue CSS (native) |

The xapp's own CSS was tuned against a real Android device for the **miniapp** look, and uvue CSS
is a restricted subset (no descendant selectors, no `radial-gradient`, …). Restyling 30k lines
of uvue by hand to look like the user-app would have produced an approximation that drifts.
Instead, **the web build renders the xapp's markup with the user-app's own stylesheet**:

- **Identical by construction.** Where the markup matches (88% of the main page's classes and
  81% of the health component's matched on the first measurement), the result is the same CSS on
  the same class names.
- **Native untouched.** Every web difference is behind `#ifdef WEB` / `/* #ifndef WEB */`, or
  lives in `static/web/`, a folder the native build ignores. The native look was verified on a
  device; nothing here re-verifies it.

## 2. Build pipeline

```
tools/xapp-web/build.sh
  ├─ node tools/xapp-web/sync-css.mjs → src/xapp/static/web/user-app.css   (generated, git-ignored)
  └─ HBuilderX's compiler: plugins/uniapp-cli-vite/…/vite-plugin-uni/bin/uni.js build -p h5
       UNI_PLATFORM=h5 UNI_UTS_PLATFORM=web UNI_INPUT_DIR=src/xapp …   (env captured from xcli)
     → src/xapp/unpackage/dist/build/web
tools/xapp-web/serve.js  static files + /api proxy → nano-dev (or --target)
```

- **Why not `xcli` directly.** `xcli publish web` refuses without a DCloud-registered `appid`
  (`manifest.json` has none). On Linux, `xcli launch web --compile true` starts a dev server and
  kills it as soon as the compile completes. The command and environment `xcli` spawns were read
  from `/proc` on HBuilderX 5.26, and `build.sh` runs them in build mode. It must run from the
  plugin directory: `vue` and `@dcloudio/*` resolve from its `node_modules`.
- **`src/xapp/index.html`** is required by the web target. Its entry is `/main.uts`. Vite
  rewrites the file, so stylesheets are injected from `main.uts` (§3), not as `<link>`s.
- **Same-origin API.** `utils/config.uts` splits `API_ORIGIN` (the backend, used for dev-vs-prod
  decisions and absolute links) from `BASE` (the request prefix; `''` on web). The worker's CORS
  preflight returns two `Access-Control-Allow-Origin` values (the gateway's and the handler's),
  which browsers reject, so a cross-origin page cannot call it. The user-app solves this the same
  way, with a dev proxy and same-origin hosting.
- **`sync-css.mjs`** assembles `user-app.css` in `user-app/src/main.jsx`'s import order:
  1. `theme-tokens.css` and `style.css` from the user-app;
  2. the miniapp WXSS (main, toolbox, user-health, health-documents, viva-ag-panel,
     avatar-picker, phones, emails, referral), converted by the user-app's own rules (rpx ÷ 2 = px,
     `page{}` dropped) but with element selectors mapped to uni's elements (`uni-view`,
     `uni-text`, …);
  3. the user-app's generated `coach.css` (its `div`/`span`/`img` remapped) and `coach/coach.css`;
  4. `web-overrides.css`.

  It converts from the **current WXSS**, not from `user-app/src/mini-css`. That copy is only as
  fresh as the user-app's last `npm run sync:css`; it was ~380 lines behind on 2026-10-01. Until
  the user-app re-syncs, the two web clients can differ slightly in recently changed areas.

## 3. Styling model

`main.uts` (`#ifdef WEB`) appends `/static/web/user-app.css`, then `/static/web/xapp-web.css`, to
`<head>`. Both load after uni's base CSS.

The xapp's own `<style>` blocks are native-only on the main page and its components (user-health,
health-documents, viva-ag-panel, toolbox), the login page and the full-screen pages:
`/* #ifndef WEB */ … /* #endif */`.

`static/web/xapp-web.css` is the glue. Every rule there exists because of one of these:

| Problem | Rule |
|---|---|
| uni-app x makes every `uni-view` a clipped flex **column**; the WXSS assumes block/row | reset to `display:block; flex-direction:row; overflow:visible` (element selectors at `html uni-app …`, so they beat uni's base and lose to any class) |
| `<text>` is a block in uni, inline in WXML | `uni-text { display:inline }` |
| uni pins `font-size:16px; text-align:left; letter-spacing:0` on every node, so nothing inherits | reset to `inherit`, 16px root (uni also scales `<html>`'s font-size for rem) |
| The user-app wraps tabs in `.tab-pane`; its `web-overrides.css` resets `.chat-tab` etc. to `relative` | `.tab-content > .chat-tab { position:absolute; inset:0 }` |
| A vertical `scroll-view`'s content box is a flex row, which sizes to the longest line | `.uni-scroll-view[style*="hidden auto"] > .uni-scroll-view-content { display:block }` |
| Class-less `<view>` hosts of `v-if`/`v-for` (a WXML `<block>`) break a parent's `gap` | `display:contents` on those wrappers in `.dt-sa-col` and `.chat-inner` |
| uvue has no descendant selectors, so the native port renamed e.g. `.pkg-cta-ghost .pkg-cta-text` → `.pkg-cta-text-ghost` | alias rules with the miniapp's token values |
| Desktop phone frame | `main.uts` adds the user-app's `.shell` to `<body>` and `.phone-frame` to `#app`; `style.css` draws the silhouette |
| uni's own modal / toast / action sheet | restyled to the user-app's `.ui-modal` / `.ui-toast` / `.ui-sheet` values |
| Theme and text-scale tokens live on `:root.theme-light` / `:root.fs-N` | `utils/web-ui.uts` `syncRootClasses()`, called from main/coach via `watch` |

**Web-only templates.** Where the xapp's markup diverged from the miniapp's (simplified "structural
ports"), the page renders the miniapp's markup under `<!-- #ifdef WEB -->`, bound to the
existing script, and keeps its native template under `#ifndef WEB`:

| Page | Web template mirrors |
|---|---|
| `pages/login` → `components/web-login` | user-app `LoginScreen.jsx`: phone / email / **WeChat QR** tabs, 中/EN toggle, invite step (`require_invite`), `?invite=` / `?channel=` URL params, logged-out card |
| `pages/phones`, `pages/emails` | miniapp `phones.wxml` / `emails.wxml` (user-app `IdentityPage`), plus the resend cooldown |
| `pages/referral` | miniapp `referral.wxml` (user-app `ReferralPage`); 分享给好友 uses Web Share or copies `?invite=` |
| `pages/coach` | miniapp `coach.wxml` in the user-app's `.web-coach` wrapper (refresh button, appointment form); the client chat uses the main chat's markup like the user-app's coach-mode `ChatTab` |

## 4. Web-only behaviour

| Feature | Implementation | Why |
|---|---|---|
| GCN storefront | `utils/web-open.uts` `openInNewTab()`: blank tab opened synchronously, then navigated with a minted `wvt` (same `context` contract as appview, AGENTS §31) | GCN sends `X-Frame-Options: sameorigin`; a tab opened after an `await` is popup-blocked |
| QR scan | `utils/web-ui.uts` `scanQr()` + `setScanTitle()`: the user-app's scanner (camera via `BarcodeDetector`, manual field otherwise). Call sites: box activation, Kino chip test (`tool-actions.uts`), coach box scan, qrlogin | `uni.scanCode` is an "unsupported" stub on web |
| Voice input | `utils/web-speech.uts`: press-and-hold Web Speech, merged into the input like `main.js:_onMicStop` | the user-app's `VoiceInput`; native still toasts (ASR TODO) |
| Upload bytes | `utils/file-bytes.uts` `readFileBytes()`: `fetch(blobURL).arrayBuffer()` | native file read is still a TODO; returns `null` there |
| Window width | `main.uts` wraps the global `uni.getWindowInfo()` to report the frame's size on desktop | rpx ratio, chart widths and the Dots strip scroll were sized from the browser window |
| Logo menu | 渠道管理 (admin) and 网页后台 (superadmin) open `/admin/` in a new tab; email management on every channel; Kino simulator hidden; dropdown position from CSS | the user-app's `LogoMenu` |
| 魔盒 | Kino APK download card | the user-app's `LearnTab` (the miniapp lost the card from its markup) |
| Markdown colour | the dark-text `MD_TAG_STYLE` injection in `main.uvue` is native-only | uni's native rich-text doesn't inherit colour; on web it does, and the injection broke light theme |

## 5. Bugs found on the way (fixed for every platform)

- **Coach panel never loaded clients.** The coach id is a number; `getString('id')` returns null
  for numbers, so `_coachId` stayed empty and the repair call failed the same way. Fixed with
  `utils/json-id.uts` `idOf()`, which is also used at the other numeric-id reads (reminders,
  orders, cart items, quiz questions, `coach_id`).
- **Coach logic vs the miniapp:**
  - invites read `status`/`used_count` instead of `is_active`/`use_count`;
  - KPIs read `active`/`at_risk` instead of `active_clients`/`at_risk_count`;
  - questionnaire responses were queried per questionnaire instead of per client;
  - reminders couldn't target the tapped client;
  - the goal form was bio-age-only and facts were always saved as `preference`;
  - the chat toolbox, top improvers, chat roles and loading states were missing.
- **`user-health`** called the `_moodRaw` method without `this.`, so the mood avatar never
  updated from ring data.
- **Kotlin-only `.size` on arrays** (`arrLen`, touch handlers). It is `undefined` on web, which
  zeroed counts (方案 today-progress 0/0) and broke pinch and swipe.
- **`App.uvue`** `JSON.parse('')` on a missing storage key (web returns `''`, Android `null`).
- **Display of Postgres `count`s**, which arrive as strings: `getNumber` returned null, so the coach
  plan check-ins showed 0.

## 6. Verification (2026-10-01)

Side-by-side `tools/web-review` screenshots of xapp-web against the user-app, same dev user, mobile and desktop:

- **Match:**
  - login (all three tabs, both languages) and the logo menu;
  - chat (incl. formulation card), health / twin, plans (原粒 and 方案), learn (学院 and 魔盒);
  - phones / emails / referral;
  - coach (clients, invites, earnings, questionnaires, CRM, client detail tabs, client chat);
  - the scanner and the dialog / action sheet / toast styling;
  - light theme and the desktop phone frame.
- **End to end on dev:**
  - a chat message sent from the web build received its async reply;
  - box-activation scan reached `/box-claim` and showed the same error dialog as the user-app;
  - the store tab opened `aeviva-dev.gcn.net/dashboard.html?wvt=…` in a new tab, like the user-app.
- **Native:** `~/HBuilderX/cli launch app-android --project src/xapp --compile true` →
  *Project xapp compiled successfully* after all changes. Native visuals were not re-checked on a
  device.

## 7. Known gaps

- **Coach client chat** renders cards read-only. The user-app's coach-mode `ChatTab` also has
  history paging, voice input and card actions.
- **Built but not exercised end to end:** image / document upload, voice input, WeChat QR login,
  invite signup.
- **Small residual spacing differences** in a few places: modal body padding, the user-app's
  scroll position on chat load.
- **`xcli publish web`** still needs a registered `appid`. Deployment hosting (same-origin with
  `/api`) has not been decided.

## 8. Rules for changing the xapp from here on

- **New markup:** use the miniapp's class names, and nest elements the way the WXML does. On web
  that markup is styled for free; a renamed class needs an alias in `xapp-web.css`.
- **Web-specific code:** guard it with `// #ifdef WEB`, and keep DOM APIs out of native paths. In
  templates, `<!-- #ifdef WEB -->`; in CSS, `/* #ifndef WEB */`.
- **Don't patch `uni.*` globals.** Page code imports uni APIs as tree-shaken bindings, so
  reassignment doesn't reach it. Write a helper (like `scanQr`) or restyle with CSS.
- **Arrays use `.length`, never `.size`.** **Ids go through `idOf()`.** Storage reads tolerate `''`.
- **Before handing off:**
  - run `tools/xapp-web/build.sh` and a `web-review` pass;
  - run the Android compile **alone**: together with headless browsers it ran this 4 GB box out
    of memory twice;
  - bump `VERSION` in `utils/config.uts`.
