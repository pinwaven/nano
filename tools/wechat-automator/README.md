# wechat-automator

Reusable [`miniprogram-automator`](https://www.npmjs.com/package/miniprogram-automator) connect/launch
helper for driving `nano-miniapp` inside WeChat DevTools — for verifying miniapp UI changes live
(scroll behavior, conditional rendering, data flow) instead of relying on code review alone.

This wraps the manual flow documented in the root `CLAUDE.md` ("WeChat DevTools Automation") with a
single reusable module, so each debugging session doesn't have to rediscover the connection dance
and its gotchas from scratch.

## Setup

```bash
cd tools/wechat-automator
npm install
```

Also enable the Service Port once, if not already on: WeChat DevTools → Settings → Security
Settings → turn on "Service Port" (`22038`). This is the IDE's CLI HTTP port — it's a prerequisite
for `cli auto`/`automator.launch()`, but the automation websocket itself runs on a separate port you
choose (see below).

## Quick start

```js
const { launch } = require('./connect');

const mp = await launch(); // opens the project, enables automation, connects — one call
const page = await mp.currentPage();
console.log(page.path);
await mp.disconnect();
```

Or run the smoke test directly:

```bash
node example.js
```

## API (`connect.js`)

- `launch({ port, freshStart })` — opens the project (if needed), enables automation, and connects.
  Prefer this over manually shelling out to `cli auto` + `automator.connect()` — see gotcha below.
  Pass `freshStart: true` to force a clean `quit` + process kill first (slower, but recovers from a
  stuck prior session).
- `connect(port)` — attaches to an already-running automation session on `port`. Fails fast if
  nothing is listening — useful as the fast path when you know DevTools is already open.
- `coldStart()` — quits the project and force-kills stale processes; used internally by
  `launch({ freshStart: true })`, exposed for manual recovery too.
- `killStaleProcesses()` / `quitProject()` — the individual steps of `coldStart()`.
- `DEFAULT_PORT` (`22090`), `PROJECT_PATH`, `CLI_PATH` — the constants everything above uses.

## Gotchas (confirmed live this session — don't re-debug these)

- **The Service Port is not reliably 22038.** It's per-machine configurable (Settings →
  Security Settings → Service Port) and confirmed live to sometimes be a different value —
  `launch()` failing fast with `Failed to launch wechat web devTools, please make sure http
  port is open` (not a timeout/hang) usually means this, not a stale project window. Check
  the actual value in the running IDE's Security Settings and pass it as `servicePort` to
  `launch()`, e.g. `launch({ servicePort: 37776 })`.
- **`cli auto` against an already-open, stale project window can hang.** Symptom: `routeTo
  appLaunch timeout` in the IDE's `WeappLog` logs, and the simulator never finishes booting.
  `automator.launch()` (open + auto + connect in one call) is the reliable path from a cold start —
  that's what `launch()` here uses. If you still get stuck, run `node cleanup.js` (or
  `launch({ freshStart: true })`) and retry.
- **Port conflicts / zombie processes.** Repeated launch attempts across sessions can leave orphaned
  `wechatwebdevtools`/`WeChatAppEx` processes holding a port. `node cleanup.js` force-kills both
  (`pkill -9 -f wechatwebdevtools`, `pkill -9 -f WeChatAppEx`) — safe to run any time nothing
  important is mid-test in the simulator.
- **Screenshots don't work in this environment.** Both `page.screenshot()`-style automator calls and
  macOS `screencapture` fail here (`fail to capture screenshot` / no screen-recording permission).
  Don't rely on visual screenshots for verification — use DOM-level queries instead:
  `page.data()`, `element.size()`, `element.offset()`, `element.scrollHeight()`,
  `element.property('scrollTop')`, `element.outerWxml()`. `example.js` demonstrates this pattern.
- **`outerWxml()` returns tags with EMPTY text nodes — use `text()` for content.** A
  `<text>{{t.x}}</text>` comes back as `<text class="…"></text>` no matter what it rendered, so
  asserting on strings (or on "no empty `<text>`", the obvious way to catch a missing i18n key) via
  `outerWxml()` fails on correct markup. `outerWxml()` is for structure — classes, `data-*`
  attributes, how many of a repeated element rendered; `element.text()` is for content, and returns
  the subtree's visible text newline-joined, which is what makes a resolved-vs-empty i18n check
  possible in both languages.

- **A passing `element.tap()` does NOT mean a user can tap it.** `tap()` dispatches at the element
  you selected, so it exercises the handler and its `data-*` wiring while telling you nothing about
  whether the target is *reachable*. A collapsible card shipped this way with only its 17px title
  row bound: the tap test passed, and on a real device 81% of the block — the part a finger actually
  aims at — was dead. Measure coverage instead: `parent.size().height` against the summed
  `size().height` of the elements that carry the `bindtap`, and assert the ratio.
- **`bindtap` on a bare `<text>` does not fire; put it on a wrapping `<view>`.** Confirmed live: the
  identical handler and `data-*` attributes on a `<text>` node produced no event, and moving them to
  a `<view>` wrapping that same `<text>` worked immediately. Applies to automator taps and, from the
  report that led to finding it, to real taps too.
- **Synthetic touch gestures don't trigger real scroll-view scrolling.** `touchstart`/`touchmove`/
  `touchend` dispatched at a `scroll-view` element show zero `scrollTop` change — confirmed even on
  a known-working scroll-view via a control test, so it's an automator/simulator limitation, not a
  bug in the miniapp. Use `ScrollViewElement.scrollTo(x, y)` directly instead, and confirm with
  `.property('scrollTop')` — this is what actually moves content and reports back reliably.
- **`wx.storage` persists across relaunches, per-project.** The simulator keeps a real storage
  database on disk (`~/Library/Application Support/微信开发者工具/<project-hash>/WeappSimulator/
  WeappStorage/`), so whichever account was last logged in (via a real OTP login or a superadmin
  "Login as") stays logged in across `reLaunch`/relaunches — it's not reset per session. Use
  `page.setData({ ... })` / `page.callMethod(...)` for scoped test state instead of assuming a fresh
  login each run.
- **Computed styles are reachable — but only via `wx.createSelectorQuery()` inside `mp.evaluate()`.**
  automator's `Element` API has no computed-style accessor (`size()`/`offset()`/`attribute()` only),
  so for anything colour/layout-related run a selector query in the app-service context:
  `q.selectAll('.cls').fields({ computedStyle: ['color', 'backgroundColor'], rect: true, size: true }, cb)`
  then `q.exec(() => resolve(out))`. Values come back as `rgb()`/`rgba()` strings. This is what makes
  a real contrast/theme audit possible without screenshots.
- **To reach inside a custom component, use the `>>>` deep combinator — not `.in(component)`.**
  Both `wx.createSelectorQuery().in(comp)` and `comp.createSelectorQuery()` return *empty* here,
  even for the component's own root node. `wx.createSelectorQuery().selectAll('#comp-id >>> .cls')`
  from a plain page-level query is what actually crosses the boundary. Note the runtime class names
  inside a component are prefixed by style isolation (e.g. `.uh-root` renders as
  `health--uh-root`), which `>>>` handles for you but a hand-built selector will not.
- **`mp.evaluate()` has a hard response timeout; batch selector queries in small chunks.** A single
  `evaluate` issuing ~120 plain `selectAll` calls is fine, but `>>>` deep queries are far more
  expensive — more than ~4-8 per `evaluate` reliably trips `timeout waiting for automator response`.
  Chunk them and merge the results.
- **A long session degrades the simulator.** After many hot recompiles, even a plain
  `page.setData({...})` starts timing out while `page.data()` still works. That's the simulator, not
  your script — `launch({ freshStart: true })` (a full quit + kill + relaunch) restores it, and
  afterwards the *same* sweep that was timing out completed and probed ~3x more rendered nodes.

## Not included here

One-off debugging/repro scripts (bisecting a specific bug, one-time data probes) don't belong in
this tool — write those to your scratchpad directory for the session and let them go, exactly like
any other throwaway script. Only put something here if it's generically reusable across future
debugging sessions.
