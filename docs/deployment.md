# Deployment Guide

All deployments use [Serverless Devs](https://www.serverless-devs.com/) (`s` CLI) and the configuration in `s.yaml`.

> [!CAUTION]
> **Domain Configuration Warning:** Running `s deploy` or `s nano-domain deploy` will reconcile the domain state on Alibaba Cloud to match `s.yaml`. 
> 
> If you are using HTTPS with a custom certificate, you **MUST** ensure your certificate files are present in the `./certs` folder before deploying. If they are missing, the Aliyun configuration will be reset to HTTP only, disabling HTTPS.

## Local Certificate Setup

To maintain HTTPS support during deployment:
1. Ensure the `./certs` directory exists (it is git-ignored).
2. Place your certificate files in `./certs/fullchain.pem` and `./certs/privkey.key`.

## Dev vs Prod

| | Dev | Prod |
|---|---|---|
| DB | `nano_db_dev` | `nano_db_prod` |
| s.yaml | `s.yaml` | `s-prod.yaml` |
| Deploy suffix | _(none)_ | `-prod` |
| DB migrate | `npm run migrate:dev` | `npm run migrate:prod` |

Always deploy and test on dev first. See [Database Migrations](architecture/database-migrations.md) for the full migration workflow.

## Functions

| Name | s.yaml key | Description |
|---|---|---|
| `nano-dispatcher` | `dispatcher` | Cron-triggered user scanner |
| `nano-worker` | `worker` | AI processing + HTTP API |
| `nano-admin-panel` | `admin-panel` | Admin SPA + simulator host |
| Domain config | `nano-domain` | Custom domain routing for `nano.gcn.net` |

## Deploy commands

```bash
# Deploy everything
s deploy -y

# Deploy a single function
s dispatcher deploy  -y
s worker deploy -y
s admin-panel deploy -y

# Deploy only the domain routing
s nano-domain deploy -y
```

## Environment variables

All sensitive values are set in `s.yaml` under each function's `environmentVariables`. The shared variables are:

| Variable | Used by | Description |
|---|---|---|
| `DATABASE_URL` | All functions | PostgreSQL connection string (takes precedence over individual DB_* vars) |
| `DB_HOST` | dispatcher, worker | PolarDB host (fallback when DATABASE_URL not set) |
| `DB_NAME` | dispatcher, worker | Database name |
| `DB_USER` | dispatcher, worker | Database user |
| `DB_PASS` | dispatcher, worker | Database password |
| `DB_SSL` | dispatcher, worker | Set to `"false"` for internal VPC connections |
| `TZ` | All functions | Timezone — set to `Asia/Shanghai` |
| `DASHSCOPE_API_KEY` | worker | Aliyun DashScope API key for LLM calls |
| `DASHSCOPE_HOST` | worker, agent | Model Studio API host, no path. Unset → the shared `https://dashscope.aliyuncs.com`. Dev is on the workspace-dedicated domain `https://llm-u2y1wl9irqjstpnp.cn-beijing.maas.aliyuncs.com` (2026-09-21); prod stays on the shared host until flipped in `s-prod.yaml`. Every LLM call site appends `/compatible-mode/v1` (OpenAI SDK) or `/api/v1/...` (native, `avatarGen.js`) to it — the API key must belong to that workspace. Ref: https://help.aliyun.com/zh/model-studio/regions |
| `MODEL` | worker | LLM model name (default: `qwen-turbo`) |
| `WORKER_URL` | dispatcher, admin-panel | Internal VPC URL of `nano-worker` |
| `WORKER_FUNCTION_NAME` | dispatcher | FC function name of the worker |

## Domain routing (`nano.gcn.net`)

Defined in `s.yaml` under `nano-domain`. Current routes:

```yaml
routes:
  - path: /admin      → nano-admin-panel
  - path: /admin/*    → nano-admin-panel
  - path: /admin/api/* → nano-admin-panel (proxied to worker)
  - path: /worker     → nano-worker
```

## Admin panel deployment notes

The admin panel serves both the compiled React SPA (`dist/`) and the simulator builds (`sim/`). When updating simulators, rebuild them first before deploying:

```bash
cd tests/chat-simulator && npx vite build
cd ../coach-simulator     && npx vite build
cd ../..
s deploy admin-panel -y
```

See [Simulator Build & Deploy](simulator-build-deploy.md) for full details.

## Logging

Logs stream to Aliyun SLS (`nano-ai-logs` / `nano-ai-logstore`). Tail live:

```bash
s logs -f worker --tail
s logs -f dispatcher --tail
s logs -f admin-panel --tail
```

See [FC Logging Setup](fc-logging-setup.md) for first-time SLS provisioning.

## WeChat miniapp domain configuration

The miniapp makes outbound network requests to two distinct external services. Both domains must be registered in the WeChat admin console under **开发 → 开发管理 → 服务器域名**, or all requests to them will be silently blocked in production.

### Required domains

| 类型 | Domain | Why |
|---|---|---|
| request合法域名 | `nano.gcn.net` | All API calls (`wx.request` to the FC worker) |
| request合法域名 | `waven-nano.oss-cn-shanghai.aliyuncs.com` | Presigned PUT uploads for user avatars |
| downloadFile合法域名 | `wx.qlogo.cn` | WeChat profile picture downloads (older WeChat versions where `chooseAvatar` returns an HTTP URL instead of a local temp path) |


### Why this matters

`"urlCheck": false` is set in `src/mini/nano-miniapp/project.config.json`. This disables domain validation in the DevTools simulator, so every domain works locally. In production (any uploaded/released build), WeChat strictly enforces the whitelist — requests to unlisted domains call the `fail` callback without ever leaving the device, with no visible error.

**Symptom of missing OSS domain:** `avatar_url` stays `null` in the DB after guest sign-up. The avatar preview appears in the sheet (it shows the local WeChat temp path), but the OSS upload never completes. The Continue button re-enables as if the upload succeeded, and the save step is silently skipped.

### How to add domains

1. Log in to [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. 开发 → 开发管理 → 服务器域名
3. Click **修改** next to request合法域名
4. Add each domain on its own line (scheme must be `https://`)
5. Save — changes take effect immediately for production builds; DevTools requires a re-open

## VPC configuration

All functions share the same VPC to allow internal communication between dispatcher → worker:

| Setting | Value |
|---|---|
| VPC ID | `vpc-uf6oezl8wt6efyczo7wa4` |
| vSwitch | `vsw-uf6438oo047ucsbmlvmxw` |
| Security Group | `sg-uf6hwn97w4pz60mmfgwz` |
| IAM Role | `acs:ram::1719995052853530:role/aliyunfcdefaultrole` |

---

# Appendix: the `CLAUDE.md` §32 (shared PolarDB cluster incident) record (moved here verbatim 2026-09-15)

The project-rules entry as it stood before being condensed; the rules that must hold are now
summarised in `CLAUDE.md`. Kept because it records decisions and live findings in the words they
were made in.

## 32. Shared PolarDB Cluster with GCN — Connection Exhaustion Incident (2026-08-16)

**This cluster is not nano-exclusive.** `pc-uf6ttj5kse63r270k` (console description "nano-polardb",
`polar.pg.sl.small.c`, region `cn-shanghai`) hosts `nano_db`/`nano_db_dev`/`nano_db_test` *and*
GCN's `gcn_db`/`gcn_db_dev` — GCN's `DATABASE_URL`/`DATABASE_URL_PROD` point at this same cluster's
public endpoint (`amclbdsyqvfq.rwlb.rds.aliyuncs.com`), just a different database name. This wasn't
documented anywhere in either repo before this incident — found only by tracing the connection
string via `aliyun polardb DescribeDBClusterEndpoints`.

**Incident**: 2026-08-16 ~08:39 UTC, GCN prod started failing all DB connections with `Sorry, too
many clients already` / `number of normal user connections (193) plus polar super user connections
(8) have exceeded limits`. `pg_stat_activity` on the shared cluster showed 227 total backend
connections, 181 of them `nano_admin`/`nano_db` — GCN's own usage was 1 connection. Root cause: all
five of nano's Postgres `db.js` copies (`worker`, `dispatcher`, `agent`, `lab`, `kino`) constructed
`new Pool({...})` with **no explicit `max`**, so each defaulted to `node-postgres`'s built-in cap
of 10 — and since each warm FC container gets its own module-level pool with no cross-container
coordination, a burst of concurrent FC scale-out had no ceiling on the aggregate connection count
across all of them. Contrast with GCN's own `auth/lib/db.js`, which has always capped `max: 5`.

**Why PolarDB Serverless autoscaling didn't absorb this**: `DescribeDBClusterServerlessConf` shows
`ScaleMax: 4` (PCU) and `ServerlessRuleCpuEnlargeThreshold: 85` — scale-up triggers on CPU%
crossing 85, nothing else. The connection storm was mostly idle pooled connections, not compute
load: CPU peaked at 46.8% during the incident (never near the 85% trigger), even though memory
usage did spike (2% → ~48%, since every open backend connection costs PolarDB per-connection
shared memory regardless of whether it's doing work). A pile of idle-but-open connections is
invisible to this cluster's autoscaling policy.

**Fix**: added `max: 5, idleTimeoutMillis: 10000` to every `new Pool({...})` call in all five
`db.js` copies (`worker`/`dispatcher`/`agent`/`lab`/`kino`, both the `DATABASE_URL` and discrete
`DB_HOST` branches), mirroring GCN's own already-safe pattern. `worker/lib/estimator/db.js` is a
Tablestore client, not Postgres — untouched, not part of this issue. Deployed to all five functions
on both `s.yaml` (dev) and `s-prod.yaml` (prod) — 10 deploys, `npm run deploy:<fn>` /
`npm run deploy:<fn>:prod`. Verified live: `pg_stat_activity` on the shared cluster dropped from
227 total / 181 `nano_admin` to 46 total / 5 `nano_admin` within minutes of the prod deploys as old
unbounded-pool containers cycled out; GCN prod connections succeeded cleanly afterward.

**Known gap, not fully closed by this fix**: capping each pool at 5 lowers the ceiling per
container but doesn't remove it — enough simultaneous warm FC containers across all five functions
can still exhaust the shared cluster's connection budget (~200 at the then-current 1-PCU serverless
tier) under a big enough traffic burst, and PolarDB Serverless's CPU-only scale-up trigger still
won't reliably catch a connection-count-driven (rather than compute-driven) squeeze. No FC-level
concurrency cap was added as part of this fix. If this recurs, check `pg_stat_activity` grouped by
`usename`/`datname` on this cluster first — nano and GCN are genuine neighbors on shared infra, not
two independent databases, and either side's connection behavior can take the other down.

