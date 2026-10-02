# nano-xapp — uni-app x port of the WeChat miniapp

> Runbook, device-vs-simulator parity harness, and the uvue/UTS porting rules:
> [docs/architecture/xapp-uniapp-port.md](../../docs/architecture/xapp-uniapp-port.md).
> This file is the per-file status / port-decisions / fix log.

Trial port of `src/mini/nano-miniapp/` (~38k lines: 11 pages, 7 components, wearable BLE stack)
to **uni-app x** (UTS + `.uvue`, compiled to native Android/iOS). Started 2026-10-01 with the
known costs accepted (full rewrite, no code reuse) — this tree lives beside the miniapp, which
stays the production frontend untouched.

## Toolchain

- **HBuilderX is required** to run/compile a uni-app x app (no official CLI; the CLI template
  docs state app release needs HBuilderX). Install from `https://download.dcloud.io/hbuilderx/
  release.json` (macOS arm64 dmg listed there), import this folder, Run → Android.
- No compiler on the port machine, so two offline gates stand in until the first device build —
  run BOTH after every port change:
  - `node temp/uts-smoke/build-and-compare.js` — logic equivalence of every ported `.uts` util
    vs the miniapp original (seeded vectors, currently 2715/2715 including the whole markdown
    segmenter and the sync event builder).
  - `node temp/uts-smoke/triage.js` — esbuild parse of every `.uts` file + every `.uvue`
    `<script>` block (catches syntax/reserved-word errors; NOT a UTS type check).
- Expect first-compile type errors regardless (RequestMethod naming, UTSJSONObject generics,
  Date parsing, uni.* API option types). Fix at compile time; do not pre-guess.

## Key port decisions

| miniapp | xapp | why |
|---|---|---|
| `envVersion` → `BASE` in `utils/config.js` | `BUILD_ENV` constant in `utils/config.uts` | no WeChat channels natively; flip to `release` before a store build (dev/prod per AGENTS §2) |
| `wx.login` + openid | phone/email OTP (server already supports, AGENTS §33) | WeChat login doesn't exist outside WeChat; `EMAIL_LOGIN_AVAILABLE = true` (root Waven) |
| `App().globalData` | module singleton `utils/state.uts` | uni-app x convention |
| `wx.setStorageSync('nano_base')` guard | kept verbatim in `App.uvue` onLaunch | same cross-backend session-leak incident (2026-09-19) |
| `wx.onNeedPrivacyAuthorization` | dropped — OS permission prompts | WeChat-only |
| `wx.getUpdateManager` OTA modal | dropped for now (uni-app x has its own wgt path) | WeChat-only |
| WechatSI plugin (语音转文字) | **gap** — no equivalent yet | native ASR or drop the mic button |
| signup `?ref=` referral capture | **gap** — rode `/wx-login` only; `/phone-otp/verify` has no `ref` param, so referral binding for xapp signups needs a small server addition | note in pages/login/login.uvue |
| Halo/V8 BLE via `wx.*Bluetooth*` | **gap** — uni-app x has no built-in BLE APIs | needs a UTS BLE plugin (marketplace: BLE Kit id=29317, xm-uts-ble id=29718) or a hand-written one; porting plan in task list keeps protocol logic behind a transport interface |
| `mp-html` component | TBD during component port | uni-app x `<rich-text>` or a UTS renderer |
| bare-JSON-array API responses | `uni.request<UTSJSONObject>` only parses objects | array endpoints need `responseType:'text'` + `JSON.parse` — handle per call site |

## Status — PORT COMPLETE + FULL ANDROID COMPILE GREEN (trial stage), 2026-10-01

ALL miniapp surfaces are ported: 11 pages (incl. `main` at 8,062 lines with the five tabs, the
Kino simulator overlay, async chat §22 and dictionary `utils/main-t.uts`), 7 components
(user-health 7,169 / health-documents / viva-ag-panel / strip-record / toolbox / avatar-picker
gallery-only), the wearable stack, and every util. i18n dedup: `utils/i18n.uts` keeps only the
shared `tr` lookup — the dictionary lives once, in `main-t.uts`.

Verification state of the whole tree (no device run yet):
- `node temp/uts-smoke/triage.js` → **43/43 parse OK**
- `node temp/uts-smoke/build-and-compare.js` → **2715/2715 logic-equivalent to the miniapp**
- **`cli launch app-android --project src/xapp --compile true` → "Project xapp compiled
  successfully"** (HBuilderX 5.26, VERSION 1001-5) — every `.uts` and `.uvue` compiles to Kotlin.
  The device-pass TODO(port) hotspots it forced and fixed: `uni.showDatePicker`/`showTimePicker`
  don't exist → `<picker mode="date"|"time">` (5.08+) everywhere; async `success:` callbacks must
  return Unit → `(async () : Promise<void> => {…})()` wrappers; the awaitable `uni.request`
  overload silently resolves to `RequestTask` in most call shapes → all requests are now
  callback-`Promise` wrappers (`_envelopeRun` in main/coach/user-health, request.uts, session.uts,
  login, sync.uts, tool-actions, health-documents); canvas via `uni.getElementById(…) as
  UniCanvasElement` + `getContext('2d')`; `replace()` callbacks need trailing `(_off, _src)`;
  `charCodeAt` is nullable; regex match groups are nullable; data fields initialized from a
  function/const need `as string`/`as boolean` (else `Any`); lifecycle hooks must be sync
  (async bodies wrapped); `showModal` uses `placeholderText`; `InnerAudioContext` has no `title`;
  CSS: no `%`/`vh` in max-width/max-height, no `align-items: baseline`, no `text-decoration`.

### What to do first on a device (the remaining known-work list)

1. **Launch on the phone + `logcat`** — the compile pass is done; the first real boot (§23 chat
   scroll, picker UI, canvas draws, `uni.scanCode`) still needs a connected device
   (`adb devices` was empty at the time of writing — re-enable wireless debugging first).
2. **BLE**: pick + wire a UTS BLE plugin behind `utils/wearable/transport.uts` (BLE Kit
   id=29317 / xm-uts-ble id=29718), then `installBleTransport()` at app launch.
3. **Binary file I/O**: `readFileBytes()` stubs in `tool-actions.uts` /
   `health-documents.uts` + `viva-ag-panel` text reads + `openDocument` — native UTS calls, one
   pass together.
4. Feature parity gaps (each `TODO(port)`-tagged): WechatSI ASR mic, wx.chooseAddress, NFC tag
   emulation in the Kino sim, subscribe-message weight reminders, mp-html link-tap, custom
   avatar generation (§20), background audio, light-theme styling pass.

## Device-vs-simulator parity sweep (2026-10-01, VERSION 1001-6)

Compared xapp (PJZ110) against the miniapp in WeChat DevTools, same user Pin (`37c8774e`) on dev,
tab by tab. Fixed in this pass:

- **Tab bar**: ported the five SVG icons (`static/icons/`) with opacity 0.35→1 active, pill
  spacing per `main.wxss` — xapp was text-only.
- **Input bar**: mic button (empty input, non-guest) renders from `mic.svg` (tap → toast; ASR
  still `TODO(port)`); plus/send buttons are 40px radius-12 squircles with the rgba(99,117,236,
  .12/.25) fills; textarea border + `placeholder-style` (the simulator's gold placeholder is a
  stale native-textarea artifact — dark CSS is `rgba(166,196,229,0.4)`).
- **Toolbox**: one row of four (uvue `min-width` is content-box — 74px made items 104px and
  wrapped 2×2; 42px+10px padding fits), icon glyphs get ` ` so ♥ renders as a text glyph,
  lavender `#6375EC` icons on the `--blue-dim` card.
- **Formulation card**: `DOT-N7 单独重置` is now a pill badge; `购买尊享套装` is the
  rgba(99,117,236,.16)+border outline CTA with `#A0B4FF` text.
- **Plans tab**: 去支付/使用配方 gold outline pills, 待付款 stage pills (and the stage class names
  are `pkg-stage-<value>` with hyphens — the old `_active` underscore never matched), wave-tint
  cards, bordered 兑换码 pill, scan icon on the activation card.
- **Header**: `A e v i v a` letter-spacing + version badge as a bordered pill.
- **Menu**: mask gets `z-index: 100` (it painted *under* the tab content, so an open menu was
  invisible on chat/health but bled through the plans tab's transparent gaps and swallowed taps);
  dropdown moved to the logo side at `top: statusBarHeight+44`; transparent mask per the miniapp.
- **Learn tab**: academy status card is the gradient card with centered credits, divider and
  stat separator. (uvue has no `radial-gradient` — the glow circles are flat tints.)
- **Health tab (three real bugs)**:
  1. `lifetimes.attached` is a miniapp concept — the block never ran in uvue, so the whole
     server-side wearable hydration was dead. Converted to `mounted()`/`unmounted()`.
  2. `subAgeHistory` filter read `data.SubAges` instead of `data.bioage_profile.SubAges` →
     zero trend rows → no `›` chevrons and dead sub-age charts. Also stored as a typed `Map`
     (`getArray<UTSJSONObject>` on a `UTSJSONObject`-nested Kotlin list fails its generic check).
  3. `hasTwinData` kept the miniapp's `!ringData ? … : prev` race — on-device the ring hydration
     reliably won and the twin section stayed empty forever; now derived from the data itself.
  4. `'#RRGGBBAA'` concatenations (`tc(color) + '55'`) are not parseable by Android's color
     parser (it expects `#AARRGGBB`) — the whole declaration was dropped, so every tinted border
     (htag pills, report badges, fact chips, body-figure outlines) rendered borderless. New
     `tcA(hex, alpha)` composes `rgba()`; `border-style: solid` added wherever a rule only had
     `border-width`.
- **Text-on-view warnings**: `ring-lc-smoothed-note` ×3 are now `<text>`.

Known remaining gaps: light theme (the miniapp's ~690 `.theme-light` rules have no uvue
equivalent yet — a dynamic-class pass), BLE transport, binary file I/O, ASR mic (see list above).

## WeChat mini-program export (2026-10-01, VERSION 1001-9)

`tools/xapp-mini/build.sh` → `src/xapp-mini`, a WeChat DevTools project. Uploads read files
through `getFileSystemManager` (`utils/file-bytes.uts`). Bluetooth (Halo/V8) runs over WeChat's API through
`utils/wearable/transport-mp.uts`, installed from `App.uvue` (VERSION 1002-1); Android/iOS still have no
transport. Login on mp-weixin is the miniapp's `wx.login` flow, including guest mode for mini-program
review (VERSION 1002-4); native keeps phone/email OTP and has no guest mode. Details and gaps: [`tools/xapp-mini/README.md`](../../tools/xapp-mini/README.md).

## Web (H5) build (2026-10-01, VERSION 1001-8)

The same tree now builds for the browser and is styled to match the web user-app. Build, serve
and review recipe, styling model, web-only behaviour and traps: [`tools/xapp-web/README.md`](../../tools/xapp-web/README.md).
Bugs found on the way that affect native too:
- the coach id is numeric, and `getString('id')` returned null, so the coach panel could never
  load clients. Fixed with `utils/json-id.uts` `idOf()` and the other numeric-id reads;
- invite and KPI fields were read under the wrong names (`status`/`used_count`,
  `active`/`at_risk`; the API returns `is_active`/`use_count`, `active_clients`/`at_risk_count`);
- coach questionnaire responses were queried by questionnaire, not per client. Reminders can now
  target the tapped client, and the goal form, fact category and coach chat toolbox now match the miniapp;
- `user-health` called the `_moodRaw` method without `this.`;
- `main.uvue` `arrLen()` and the touch handlers used Kotlin `.size` (wrong on web).

## Review fixes (2026-10-01, VERSION 1001-7)

- **Legacy shared bearer removed** from `utils/session.uts` (it was shipped in the APK for a
  miniapp-storage upgrade path a native install never takes). A stored identity without a `u.`
  session is now dropped at launch → login; login's "continue as previous" requires a stored
  `session_token`.
- **qrlogin refuses a QR for the other backend** instead of switching to it — a `d:` code in a
  release build would have posted the prod session to `nano-dev`.
- Stale pull-to-refresh TODO in `main.uvue` removed (`pages.json` already enables it).
- Still open from the same review: nothing navigates to `pages/qrlogin`, and `pages/pay-qr` is
  unreachable because `appview`'s web-view has no bridge for GCN's `navigateTo`.

### History (per-phase detail, kept for provenance)

- Core utils: `config.uts`, `state.uts`, `request.uts`, `session.uts`, `phone.uts`,
      `pinch.uts`, `mood.uts`, `biomarker-series.uts`, `tool-actions.uts`,
      `avatar-gallery.uts` (generated by `temp/gen-xapp-avatar-gallery.js`)
- Aux pages: login (phone/email OTP entry only — wx silent-login/guest/invite steps
      dropped), verify-phone (+ gallery-only `components/avatar-picker`), phones, emails,
      referral (share card → copy-link), appview (web-view + `/api/webview-token` wvt kept
      verbatim), webadmin, qrlogin (inverted: app scans the QR itself — **server/panel gap:**
      the web login panel must emit a plain-text `[d:]<session_id>` QR; a wxacode image is
      unreadable outside WeChat), pay-qr (download + save-to-album).
      `assets/` copied into `static/`. UI ports are structural: templates + logic + simplified
      dark-theme styles — a styling pass against a real device is expected.
- `markdown.uts` — full segmenter (prose→html via rich-text, metric/takeaway/dots/
      formula/tiers/rungs/product/grocery/lesson/checkin directives, `:::` injection rules kept).
- `coach` page — full logic port (clients/invites/earnings/questionnaires/CRM tabs, client
      detail with chat+toolbox+plans/notes/goals/facts, reminders, appointments, managed
      customers incl. redeem + box-scan §49 flows, sandbox injection, _repairCoachSession +
      the three-state empty list with diagText from the 2026-08-30 incident). Health sub-tab
      mounts the real `user-health` component (`mode="coach"`, `profileUpdated` wired).
- `main` page + user-health/health-documents/viva-ag-panel/strip-record/toolbox components,
      ported by parallel agents to the conventions above and re-verified by all three gates.

## Harness caveats worth knowing

The smoke harness transpiles `.uts` with esbuild and shims `UTSJSONObject`/`uni`/`wx` — it
validates LOGIC, not UTS type-correctness. First HBuilderX compile will still surface type/
API-name errors (e.g. `RequestMethod`, `charCodeAt`, Date generics). It already caught: an
inverted `civil_from_days` year condition, a reserved-word field (`in`), and two record
field-name mismatches (`rmssd`, nested sleep-temp samples).

## VERSION marker

Same rule as the miniapp (AGENTS §2): bump `VERSION` in `utils/config.uts` (`MMDD-N`) on every
change under `src/xapp/`.
