# Local Testing & Simulators

Nano AI includes a suite of local simulators to test the full lifecycle without physical hardware or Aliyun deployment.

## Local servers

| Server | Command | Port | Role |
|---|---|---|---|
| Backend | `npm run start:backend` | 3000 | Express bridge for `nano-worker` — handles all worker endpoints directly |
| Admin panel | `npm run start:admin` | 3001 | Express bridge for `nano-admin-panel` — serves the admin SPA and proxies `/admin/api/*` to the backend |

Both servers read credentials from `.env`. Ensure `DATABASE_URL` points to a running PostgreSQL instance.

## Simulators (Electron + React)

All three simulators are Electron apps with Vite dev servers. They proxy `/api/*` to `http://localhost:3000` (or whatever `NANO_API_TARGET` is set to in `.env`).

### Chat Simulator — WeChat clone

- **Location**: `tests/chat-simulator/`
- **Port**: `5173`
- **Run**: `cd tests/chat-simulator && npm run dev`
- **Role**: Simulates the user's WeChat interface. Select a user, send messages, and see AI replies and notifications appear in real time via polling.

### Kino Simulator — Device clone

- **Location**: `tests/kino-simulator/`
- **Port**: `5174`
- **Run**: `cd tests/kino-simulator && npm run dev`
- **Role**: Simulates the Kino portable biomarker chip. Click **Start Biomarker Test** to submit a randomised hsCRP reading for the selected user, triggering the full AI pipeline.

### PHM Simulator — Coach mobile app

- **Location**: `tests/phm-simulator/`
- **Port**: `5175`
- **Run**: `cd tests/phm-simulator && npm run dev`
- **Role**: Simulates the PHM coach's mobile view. Displays customer biomarkers, biological age, and latest nutrition plan. Coaches can type and send instructions that appear in the user's chat.

## Simulators in the admin panel

The simulators are also available in production inside the admin panel at `/admin/simulators` — all three rendered side by side as iframes. See [Simulator Build & Deploy](../simulator-build-deploy.md) for how to rebuild and redeploy them.

## End-to-end testing workflow

1. Start PostgreSQL (`brew services start postgresql@16`)
2. Start the backend: `npm run start:backend`
3. Open the Chat Simulator (`cd tests/chat-simulator && npm run dev`)
4. Open the Kino Simulator (`cd tests/kino-simulator && npm run dev`)
5. Open the PHM Simulator (`cd tests/phm-simulator && npm run dev`)
6. In **Kino**, select a user and click **Start Biomarker Test**
7. In **Chat**, select the same user — a biological age report and nutrition plan should arrive within a few seconds
8. In **PHM**, send a coach instruction — it should appear in the user's **Chat** window

## Troubleshooting

- **Blank window**: The Vite server hasn't started yet. Electron polls until it's ready.
- **404 errors**: Check the Vite proxy settings in `vite.config.js`.
- **Database error**: Ensure `DATABASE_URL` in `.env` points to a running PostgreSQL instance (e.g. `postgresql://localhost:5432/nano_ai_db`).
- **No users listed**: The backend is not running or the database is empty.
