# Simulator Build & Deploy

The three simulators (Chat, Kino, Coach) are built from source in `tests/` and served as static files inside the `admin-panel` FC function at `/admin/sim/{name}/`.

## Directory layout

```
tests/
  chat-simulator/   ← source (React + Vite)
  kino-simulator/   ← source (React + Vite)
  coach-simulator/    ← source (React + Vite)

src/functions/admin-panel/
  sim/
    chat/           ← build output (served at /admin/sim/chat/)
    kino/           ← build output (served at /admin/sim/kino/)
    coach/            ← build output (served at /admin/sim/coach/)
```

The `outDir` in each simulator's `vite.config.js` points directly to the corresponding `sim/` folder, so no manual copy is needed.

## Updating a simulator

1. Edit the source in `tests/{name}-simulator/src/`
2. Build from that simulator's directory:

```bash
cd tests/chat-simulator && npx vite build
# or
cd tests/kino-simulator && npx vite build
# or
cd tests/coach-simulator && npx vite build
```

3. Deploy the admin-panel function:

```bash
s deploy admin-panel -y
```

## Rebuild all three at once

```bash
cd tests/chat-simulator && npx vite build && \
cd ../kino-simulator   && npx vite build && \
cd ../coach-simulator    && npx vite build && \
cd ../.. && s deploy admin-panel -y
```

## Notes

- Changes to `tests/` source have **no effect** on the deployed version until you rebuild and redeploy.
- The build output in `src/functions/admin-panel/sim/` is independent of the source — the two are only connected by the build step.
- Each simulator's `index.html` contains an XHR interceptor that rewrites `/api/*` → `/admin/api/*` so API calls route correctly through the FC domain.
- The simulators are accessible at:
  - `/admin/simulators` — all three side by side
  - `/admin/sim/chat/` — Chat simulator standalone
  - `/admin/sim/kino/` — Kino simulator standalone
  - `/admin/sim/coach/` — Coach simulator standalone

## Kino Simulator in the WeChat Mini Program

The **web Kino Simulator** (`tests/kino-simulator/`) described above is **not** the same as the Kino Simulator feature inside the WeChat Mini Program.

The miniapp's Kino Simulator is a **native WXML overlay** implemented entirely within `src/mini/nano-miniapp/pages/main/`:

- `main.wxml` — the `.ksm-overlay` view tree (ring animation, results panel, action button)
- `main.wxss` — all `.ksm-*` styles
- `main.js` — `openKinoSim`, `handleKinoSimStart`, `closeKinoSim`, slide timer logic

No build step, no iframe, no external assets. The only remote call is fetching biomarker results from `/api/biomarkers`. To change the miniapp simulator, edit those three files directly.
