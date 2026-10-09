# Plan: a native shell that runs xapp-web, with our own hot update

**Status:** proposal, 2026-10-09. Nothing is built. It replaces the Kotlin-compiled UI as xapp's
route to a native app. The China app stays on the miniapp + Donut for now
([xapp-mini-donut.md](xapp-mini-donut.md)).

## 1. Why

- **Store releases for every UI change.** The Kotlin build of `src/xapp` cannot hot-update. DCloud:
  *"uni-app x的app-Android由于编译为纯原生，没有wgt包，无法热更新"*. Every screen change would need
  an App Store / Play release.
- **Donut is not a fit outside China.** Its hot update did not deliver on the free plan (the console
  says 资源包管理 is Professional-only). Its SDK reports data to Tencent's gateway (`…sh.wxgateway.com`),
  which is a legal question for US health data. US users have no WeChat anyway.
- **Most of the app is web-shaped.** AI chat, markdown, cards, charts and forms change often and
  render well in a WebView. Only Bluetooth sync (and possibly live ECG drawing) needs native code.
- **The native port has a fixed cost on every screen.** The uvue CSS subset, the UTS porting rules
  ([xapp-uniapp-port.md](xapp-uniapp-port.md)) and open gaps: uploads fail
  (`utils/file-bytes.uts` returns null on native), and the voice-input mic is stubbed. The web build
  has none of these.

| | Kotlin-compiled UI (today) | Shell + xapp-web bundle (this plan) |
|---|---|---|
| Shipping UI changes | Store release | Hot update from our CDN |
| Where updates come from | Stores only | Our servers, region of our choice (US, CN) |
| Known gaps | Uploads, mic, CSS subset | None known in the web build |
| Speed | Native views (unmeasured) | WebView; fine for this UI |
| Bluetooth / ECG | Direct | Native in the shell; results over the bridge |

## 2. Architecture

```
┌──────────── native shell (xapp native build; store-released, changes rarely) ─────────────┐
│ splash · bundle manager · local origin server · bridge · waven-ble · session · notifications│
│ ┌──────────────── WebView ────────────────────────────────────────────────────────────────┐ │
│ │ app bundle (xapp-web build of src/xapp)  +  GCN storefront pages (phase 4)             │ │
│ │ served from local files at a fixed origin; calls nano / GCN APIs over HTTPS              │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ manifest + signed zip                                 ▲ API traffic
        │                                                       │
   bundle CDN (per region)                         nano backend (per region) · GCN backend
```

### 2.1 Shell

xapp's native build reduced to a host. It reuses `pages/appview` (already a `<web-view>`) and
`uni_modules/waven-ble`. It owns:

- the splash screen and launching the cached bundle;
- the bundle manager (§2.2);
- a local origin server (§2.3);
- the bridge (§2.4);
- secure storage for the session token;
- push notifications, the camera / QR scanning, file picking, share, and any OS permission prompts.

Its UI is minimal: everything users see after the splash screen comes from the bundle.

### 2.2 Bundle and update service

- **Bundle:** the output of `tools/xapp-web/build.sh`, zipped, plus `bundle.json` with the version,
  the minimum shell version, a content hash and a signature.
- **Manifest:** `GET <cdn>/<channel>/manifest.json`. It lists the newest bundle per shell-version
  range, the rollout percentage and a kill switch.
- **Client flow** (Donut / CodePush model):
  1. Launch the cached bundle immediately.
  2. Check the manifest in the background.
  3. Download a newer, compatible bundle and verify its hash and signature.
  4. Unpack it to a new directory and switch on the **next** cold start.
  5. If the new bundle does not report "ready" within N seconds on two launches, roll back to the
     last good bundle and report it.
- **Channels:** `cn` and `us` (different CDNs, see §3), and `beta`.
- **Release tooling:** a `tools/xapp-shell/publish.sh` that builds, signs, uploads and edits the
  manifest. The signing key stays offline from the CDN.

### 2.3 Local origin

Serve the bundle from local files at a fixed origin, never `file://`. On Android use
`WebViewAssetLoader` with `https://appassets.androidplatform.net/`. On iOS use a
`WKURLSchemeHandler`. A stable origin keeps `fetch`, storage and CORS behaving as on the web. The
nano and GCN APIs must allow that origin.

### 2.4 Bridge

uni-app x's `<web-view>` already passes messages both ways (`postMessage` from the page,
`evalJS` from the shell). Put a small, versioned RPC layer on top: request id, method, args, then a
result or error, plus event streams.

`src/xapp` gets a third platform branch next to native and `WEB`: "web inside our shell". It is
detected at runtime from a value the shell injects. Its branches call the bridge where the plain web
build falls back to browser behaviour:

| Bridge area | Methods (first cut) |
|---|---|
| session | get / set / clear the token (secure storage); logout |
| ble | `scan`, `bind`, `sync` (runs the whole sync natively, returns results), `ecgStart` / `ecgStop` (sample stream), `battery` |
| device | `scanCode`, `pickFile` (returns bytes; fixes the native upload gap), `share`, `openExternal` |
| app | shell version, bundle version, `checkUpdate`, `restartToUpdate` |
| push | permission, token, tap events |

Do not stream raw Bluetooth packets over the bridge: the shell runs the sync and posts results.
Live ECG is the one exception; first measure whether a 1.5–3 KB/s sample stream renders smoothly in
the WebView.

## 3. Regions: China and US

| | China | US |
|---|---|---|
| App delivered as | Miniapp + Donut (now). This shell later, if Donut's update or plan does not work out | This shell |
| Bundle CDN | Aliyun OSS/CDN in China (ICP filing needed) | A US CDN |
| Backend | Existing Shanghai FC / PolarDB | **New US deployment.** Every API call from the US to Shanghai costs about 150–250 ms and is less reliable |
| Login | Phone / email OTP (no WeChat inside an app) | Email / phone OTP; Apple / Google sign-in to evaluate |
| Payment (GCN) | Existing flows | A non-WeChat processor. Physical goods may use it on both stores |
| Data | Stays in China | US users' data stays in the US; no Tencent SDK in the US app |

The US backend (region, separated data, how GCN is deployed for the US) needs its own plan; this
document only assumes one exists.

## 4. Running GCN's storefront inside the bundle

Today the app opens GCN's storefront remotely. `openUserApp` gets a webview token, and GCN's
`site/<sector>/dashboard.html` (228 KB for aeviva) handles the hand-off through `ext-nano-sso.js`.

- **Bundle locally:** GCN's static pages and their JS/CSS (`site/<sector>/`, `_shared/`). Store
  screens then open instantly, navigate like the rest of the app, and update on the same channel.
- **Stays on the server:** orders, payments, stock, partners and commissions (GCN's FC functions
  and database).
- **Changes needed in GCN** (also useful to the web user-app):
  1. **API base URL.** The pages call relative paths (`/api/mall/orders`, `/api/auth/me`, …). Make
     the base configurable, and add CORS on GCN's API for the shell's origin.
  2. **Auth.** Carry the SSO session as a token, not via cookies tied to GCN's own origin.
  3. **Payment.** The pages load WeChat's JS-SDK (`jweixin-1.6.0.js`). In the shell, payment needs a
     bridge method backed by a native payment SDK.
  4. **Versioning.** GCN builds into the app bundle as a module with its own version. The manifest
     records which GCN version a bundle carries, so nano and GCN can be released independently.

## 5. Phases

| # | Phase | Scope | Estimate | Exit criteria |
|---|---|---|---|---|
| 0 | **Prototype** (Android) | Shell loads a zipped xapp-web bundle from a URL and serves it locally. One bridge call: Bluetooth scan → V8 connect → battery. Publish bundle v2 and see the switch on the next cold start | ~1 week | Both work on the OnePlus; the bridge round-trip and cold start are measured |
| 1 | Bundle manager + tooling | Signing, manifest, rollback, kill switch, staged rollout, `publish.sh`, `beta` channel | 1–2 weeks | A bad bundle rolls back by itself; a release is one command |
| 2 | Bridge + platform branch | The full §2.4 table, the shell branch in `src/xapp`, the Bluetooth sync moved into the shell, uploads via `pickFile` | 2–4 weeks | Login, chat, health, plans and learn work in the shell; Halo/V8 bind + sync + ECG work; uploads work |
| 3 | iOS shell | `WKURLSchemeHandler`, iOS Bluetooth transport (does not exist today), same bridge | 2–3 weeks | Phase 2 criteria on an iPhone; TestFlight build |
| 4 | GCN in the bundle | §4 changes in GCN; GCN pages built into the bundle; payment bridge | 1–2 weeks (plus GCN's side) | The store opens locally; an order is placed end to end on dev |
| 5 | Regions | `cn` / `us` channels and CDNs, wired to the US backend once it exists | depends on the US backend | The US build talks only to US services |

Total for phases 0–4: about **1.5–3 months for one engineer**, not counting the US backend.

## 6. Risks

- **We own the update system.** A bad bundle could break every user. Mitigations: signature check,
  automatic rollback, staged rollout, kill switch, a beta channel.
- **Bluetooth over the bridge.** Mitigation: the native sync posts results; measure live ECG
  before committing to drawing it in the WebView.
- **Store review.** Apple allows downloaded JavaScript that runs in WebKit if the app's main purpose
  does not change; Google Play allows code that runs in a WebView. Keep native-capability changes in
  shell releases.
- **Looks.** The xapp-web build is styled like the web user-app (`xapp-web.md`), not like the
  native screens. Decide on one look before launch.
- **A third platform branch in `src/xapp`.** Keep shell-specific code behind the bridge module so
  pages do not grow three-way `#ifdef`s.
- **GCN coupling.** Two repos in one bundle; mitigated by GCN's own module version (§4).

## 7. Open decisions

1. **Which looks?** The web user-app style the xapp-web build uses, or the mini / native style.
2. **US backend.** Region and cloud, data separation, and whether GCN gets a US deployment.
3. **The China app.** Stay on Donut long term (if Professional delivers hot update), or move to this
   shell too.
4. **The web user-app (`src/web/user-app`, React).** Retire it in favour of xapp-web, so one
   codebase serves the web and both apps.
5. **Who runs phase 0**, and on which device: the OnePlus 7 Pro on M3 is ready.
