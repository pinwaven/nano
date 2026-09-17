# Nano User App — a web twin of the Mini Program

**Source:** `src/web/user-app/`
**Live URL:** `https://nano.gcn.net/app/` (dev: `https://nano-dev.gcn.net/app/`)
**Stack:** React 18 + Vite 5, plain CSS. Served by the `nano-user-app` FC function
(`src/functions/user-app/index.js`, static + SPA fallback) from `src/functions/user-app/dist/`.

Since 2026-09-16 the web app is a **twin** of the WeChat Mini Program (`src/mini/nano-miniapp/`):
every end-user surface, tab, subtab, overlay and chat card the miniapp has, against the same
worker endpoints, with the same copy. It is not a redesign — it is the same app in a browser.
Three things make that hold without a second copy of everything drifting:

## 1. Shared code is imported from the miniapp, not ported

| What | Where it comes from | How |
|---|---|---|
| The `:::` chat card grammar (`mdToSegments`, `mdToHtml`) | `nano-miniapp/utils/markdown.js` | `import md from '@mini/markdown.js'` |
| Biomarker sparklines for `:::metric` | `nano-miniapp/utils/biomarker-series.js` | `@mini/biomarker-series.js` |
| Avatar gallery + mood | `nano-miniapp/utils/mood.js`, `avatar-gallery.js` | `@mini/mood.js` |
| Phone/email masking | `nano-miniapp/utils/phone.js` | `@mini/phone.js` |
| Ring chart outlier smoothing | `nano-miniapp/utils/wearable/signal-smoothing.js` | `@mini/wearable/signal-smoothing.js` |

`@mini` is a Vite alias to `src/mini/nano-miniapp/utils/`; those files are CommonJS with no
`wx.*` calls and `vite-plugin-commonjs` rewrites them for both the dev server and the build
(`vite.config.js`). **Never import `config.js`, `wearable/sync.js`, `tool-actions.js` or
`pinch.js` through it** — they call `wx.*`.

## 2. Everything else is generated from the miniapp by script

| Generated file(s) | Source | Script (root `package.json`) |
|---|---|---|
| `src/i18n/{main,health,documents,ag,phones,emails,referral}.js` | the `const T = {zh, en}` literal in each miniapp page/component | `npm run sync:i18n` (`npm run check:i18n` diffs key sets and exits 1 on drift) |
| `src/theme-tokens.css` | `app.wxss` — dark/light palette + the four text-scale levels, rpx ÷ 2 | `npm run sync:theme` |
| `src/mini-css/*.css` + `public/assets/` | every page/component `.wxss` (rpx ÷ 2, `view`→`div`, `text`→`span`) and `assets/` | `npm run sync:css` |
| `src/health/helpers.js` | the pure prelude of `components/user-health/user-health.js` (ring display builders, sleep helpers, lab tables, `_buildLabPanel`, colour maps) | `npm run sync:health` |

Ported components use the miniapp's **class names verbatim**, so the generated CSS styles them
without any web-specific rules. `src/web-overrides.css` is the only hand-written stylesheet
besides the login screen (`style.css`): scrolling (the miniapp's `<scroll-view>` scrolled
itself), native inputs standing in for `<picker>`/`<slider>`, the phone frame, and
`position:fixed` containment. Keep it small.

**After a miniapp change**, re-run the relevant sync script and re-check the JSX that mirrors
the changed WXML. `check:i18n` is the drift alarm for strings; there is none for markup.

## 3. The app state mirrors `app.js` / `main.js`

`src/store/AppContext.jsx` is `app.globalData` + `pages/main/main.js`'s page state: user /
channel / coach / lang / theme / textScale / sandbox, `isAeviva` + `gcnStoreSlug` derived from
the channel **root** (`config.js`), the Viva subscription status, credits, the active tab and
the full-screen route (phones / emails / referral). Persisted under the miniapp's own storage
keys (`nano_user`, `nano_channel`, `nano_theme`, `nano_text_scale`, `nano_last_session`,
`nano_cart`, …) so the session model is identical: a PII-stripped user object, a logout
snapshot for the "continue as previous" card, theme and text scale that also `PATCH
/users/:id`.

`src/api.js` is `utils/request.js` + `main.js:_req`: the shared app bearer (`VITE_API_TOKEN`),
`openid` as the identity, `sandbox:true` injected on non-GET in sandbox mode, per-call
`timeoutMs`, `raw:true` for handlers that answer in a non-2xx body. `putToOss` uploads with
**exactly** the presign's content type (CLAUDE.md §35).

## Directory map

```
src/
  App.jsx                 shell: header (tap → LogoMenu), banners, five always-mounted tabs, tab bar, routes, sheets
  store/AppContext.jsx    app state (above)
  api.js  config.js  gcn.js  theme.js  assets.js  lib/format.js
  hooks/useNotificationPoll.js   the two-channel chat delivery contract (main.js:_poll)
  chat/                   ChatTab, useChat (state machine), SegmentRenderer (the seven ::: cards),
                          Questionnaire + inputs, Toolbox, FocusSheet, VoiceInput, messages.js
  health/                 HealthTab (数字孪生), useHealthData (all loaders), charts.js + ChartCanvas
                          (canvas ports of the miniapp charts), HealthDocuments, VivaAgPanel, helpers.js (generated)
  plans/                  PlansTab (方案 + 原粒 subtabs), dotsStore (shared with the chat's formula CTAs),
                          CodeRedeemSheet, formulation.js (the one submit path)
  learn/LearnTab.jsx      学院 + 魔盒
  store/StoreTab.jsx      native store (GCN-linked channels open the storefront instead)
  shell/                  LogoMenu, IdentityPage (phones/emails), ReferralPage, Sheets (guest join, Viva redeem)
  components/ui/          ui.toast / confirm / actionSheet / scan / loading — the wx.show* stand-ins
  components/LoginScreen.jsx     phone OTP · email OTP (Waven tree only) · WeChat QR · continue-as card
  i18n/index.js           merges the generated tables + legacy.js (web-only login strings) + WEB_EXTRA
```

## What is deliberately different from the miniapp

- **Hardware.** Ring data renders from server `health-events` exactly as the miniapp's coach
  view does; the Bind / Sync / settings / Unbind buttons show "sync in the WeChat app". QR scans
  (Kino chip, Dots box) use the camera via `BarcodeDetector` where the browser has it, else a
  manual code field (`ui.scan`). Voice input uses the Web Speech API where available and is
  hidden otherwise. No Web Bluetooth.
- **GCN storefront** (`gcn.js`): the Store tab on a GCN-linked channel, package / formula CTAs and
  product cards mint `POST /webview-token` with the same `context` intents as `pages/appview` and
  open `https://<slug>[-dev].gcn.net/dashboard.html?wvt=` in a **new tab** (pre-opened
  synchronously — an async `window.open` is popup-blocked).
- **Files** (documents, twin reports, AG results, certificates) open in a new tab from a
  presigned URL; `.md`/`.txt` AG results render in-app via `mdToHtml`, as in the miniapp.
- **Guest → member.** The guest join sheet validates the invite code but the OTP verify
  endpoints do not accept `invite_code`, so the code is only carried to the login screen.
- **Not ported:** the admin-only Kino Simulator overlay and the coach page. Coach / admin menu
  rows link out to `/admin/`.
- **`POST /chat` sends `client: 'miniapp'`** — that literal gates the `:::` card grammar on
  the worker (`handlers/chat.js`).

## Running it

```bash
npm run start:user          # dev server on :5178, /api proxied to nano-dev.gcn.net
NANO_USER_APP_API_TARGET=https://nano.gcn.net npm run start:user   # against prod
npm run build:user          # → src/functions/user-app/dist
npm run check:i18n          # strings still match the miniapp?
```

`NANO_USER_APP_API_TARGET` is its own variable: the admin panel's `NANO_API_TARGET` points at a
bare worker and rewrites `/api`, which is not the shape this app needs. Deploy with
`npm run deploy:user` / `deploy:user:prod` (never automatically).

## Design tokens

The palette, light theme and the four text-scale levels are the miniapp's, generated into
`theme-tokens.css`. `.theme-light` and `.fs-1/.fs-2/.fs-3` go on `<html>` and on the `.main`
root (the miniapp puts them on its root view, and the generated CSS keys on both). Inline
status colours go through `themeColor(hex, theme)` (`theme.js`), the port of the `tc.c()` WXS
map, so they stay legible on the cream light surface.
