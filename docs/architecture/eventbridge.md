# EventBridge Integration

EventBridge is the internal message bus between the `nano-dispatcher` and `nano-worker` functions. It is not involved in any user-facing requests — those hit the worker directly via its HTTP trigger.

## Flow

```
nano-dispatcher (cron, every minute)
        │
        │  1. Query DB for users with < 7 days nutrition scheduled
        │  2. For each user, publish CloudEvent to default bus
        │
        ▼
Aliyun EventBridge (default bus)
        │
        │  filter: source = "acs.dispatcher"
        │
        ▼
nano-worker (EventBridge trigger)
        │
        │  Process nutrition top-up for the user
        ▼
PostgreSQL — write nutrition_schedules rows + notification
```

## Event format (CloudEvents 1.0)

```js
{
  id:              uuidv4(),
  source:          'acs.dispatcher',
  specversion:     '1.0',
  type:            'nutrition.topup',
  subject:         'user_nutrition_needed',
  datacontenttype: 'application/json',
  time:            new Date().toISOString(),
  data: {
    openid:       'user_wechat_openid',
    trigger_type: 'nutrition_topup',
    days_needed:  3,               // 7 minus however many are already scheduled
    start_from:   '2026-04-14'
  },
  extensions: {
    aliyuneventbusname: 'default'
  }
}
```

## Event types

| `type` | Published by | Consumed by | Purpose |
|---|---|---|---|
| `nutrition.topup` | dispatcher | worker | Trigger nutrition plan generation for a user |
| `agent.coaching_session` | dispatcher | agent | Wake the proactive coach agent for a user |

See [agent-system.md](agent-system.md) for the full agent flow.

## Worker trigger filter

The worker's EventBridge trigger in `s.yaml` filters to only react to dispatcher events:

```yaml
triggerType: eventbridge
triggerConfig:
  eventSourceConfig:
    eventSourceType: Default
  eventRuleFilterPattern: '{"source":["acs.dispatcher"]}'
```

## HTTP fallback

If EventBridge `putEvents` fails, the dispatcher falls back to a direct HTTP POST to the worker's internal VPC URL:

```js
await axios.post(process.env.WORKER_URL, payload, {
    headers: { 'x-fc-invocation-type': 'Async' },
    timeout: 10000
});
```

The `x-fc-invocation-type: Async` header tells FC not to wait for the worker to finish, preserving the same fire-and-forget behaviour as EventBridge.

## Why EventBridge over direct HTTP

| Concern | EventBridge | Direct HTTP |
|---|---|---|
| Coupling | Dispatcher doesn't need to know worker URL | Requires `WORKER_URL` env var |
| Retries | Automatic on delivery failure | Manual / none |
| Filtering | Rule-based — worker ignores unrelated events | N/A |
| Auditability | Events logged and replayable in console | No built-in trace |
| Latency | Small overhead (~100ms) | Slightly faster |

The HTTP fallback is the path most likely to execute in practice (EventBridge credentials can fail inside VPC), but EventBridge is the intended production path.
