# Architecture Overview

Nano AI is built on a serverless event-driven architecture using Aliyun Function Compute (FC 3.0).

## Functions

| Function | Trigger | Role |
|---|---|---|
| `nano-dispatcher` | Cron (every minute) | Scans users who need periodic reassessment; detects online users for proactive coaching |
| `nano-worker` | HTTP + EventBridge | Handles all AI processing, biomarker ingestion, chat, and admin API |
| `nano-agent` | EventBridge + HTTP | Proactive coaching — analyses user data and initiates conversations |
| `nano-admin-panel` | HTTP | Serves the admin SPA and proxies API calls to the worker |

## Public Domain (`nano.fros.cc`)

All traffic enters through a single custom domain managed by `fc3-domain`. Routes:

| Path | Function |
|---|---|
| `/admin` | `nano-admin-panel` |
| `/admin/*` | `nano-admin-panel` |
| `/admin/api/*` | `nano-admin-panel` (proxied to worker) |
| `/worker` | `nano-worker` |

## System Flow

```
User (WeChat / App)
        │
        ▼
  nano-worker  (HTTP trigger)
  ┌─────────────────────────────┐
  │ 1. Upsert user profile       │
  │ 2. Run BiomarkerEstimator    │
  │ 3. Run BioAgeCalculator      │
  │ 4. Generate nutrition plan   │
  │    via DashScope LLM         │
  │ 5. Write notifications       │
  └─────────────────────────────┘
        │
        ▼
  PostgreSQL (PolarDB)
        ▲
        │
  nano-dispatcher  (Cron trigger)
  ┌─────────────────────────────┐
  │ Periodically checks users   │
  │ due for reassessment and    │
  │ triggers worker via HTTP    │
  └─────────────────────────────┘

Admin (Browser)
        │
        ▼
  nano-admin-panel  (HTTP trigger)
  ┌─────────────────────────────┐
  │ Serves React SPA (dist/)    │
  │ Serves simulator iframes    │
  │   /admin/sim/chat/          │
  │   /admin/sim/kino/          │
  │   /admin/sim/coach/           │
  │ Proxies /admin/api/* to     │
  │   nano-worker               │
  └─────────────────────────────┘
```

## Database

Single PostgreSQL database on Aliyun PolarDB Serverless. Connection configured via `DATABASE_URL` environment variable. All functions share the same DB.

## Logging

All three functions write structured JSON logs (`console.log(JSON.stringify({level, msg, data}))`) to Aliyun SLS:

- **Project**: `nano-ai-logs`
- **Logstore**: `nano-ai-logstore`
- **Tail logs**: `s logs -f worker --tail`

See [FC Logging Setup](../fc-logging-setup.md) for provisioning steps.

## Subsystem Docs

| System | Doc |
|---|---|
| Kino Hardware | [kino-system.md](kino-system.md) |
| Questionnaire System | [questionnaire-system.md](questionnaire-system.md) |
| Role System | [role-system.md](role-system.md) |
| BioAge Calculator | [biomarker-estimator.md](biomarker-estimator.md) |
| Chat Prompt Chain | [chat-prompt-chain.md](chat-prompt-chain.md) |
| Rewards | [rewards-system.md](rewards-system.md) |
| EventBridge | [eventbridge.md](eventbridge.md) |
| Agent System | [agent-system.md](agent-system.md) |
| User Deletion | [user-deletion.md](user-deletion.md) |
| AI Report Engine | [report-engine.md](report-engine.md) |
| Health Plan System | [health-plan-system.md](health-plan-system.md) |
| Digital Twin | [digital-twin.md](digital-twin.md) |
| Reminder System | [reminder-system.md](reminder-system.md) |
