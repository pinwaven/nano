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

## Not included here

One-off debugging/repro scripts (bisecting a specific bug, one-time data probes) don't belong in
this tool — write those to your scratchpad directory for the session and let them go, exactly like
any other throwaway script. Only put something here if it's generically reusable across future
debugging sessions.
