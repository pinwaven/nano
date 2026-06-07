# Role System

## Overview

A single WeChat `openid` can hold multiple roles simultaneously. Roles are stored as a PostgreSQL `TEXT[]` array on `users.roles` (default `{user}`). There is no separate role-junction table — channel context is already carried by `users.channel_id`.

## Roles

| Role | Scope | Mini-app page |
|------|-------|---------------|
| `user` | Own health data only | `pages/main/main` |
| `coach` | Assigned clients within a channel | `pages/coach/coach` |
| `admin` | All users/coaches within own channel | `pages/admin/admin` |
| `superadmin` | Platform-wide — all channels, users, coaches | `pages/superadmin/superadmin` |

A user can hold any combination, e.g. `{user, coach, admin}`.

## Database

```sql
-- users table
roles TEXT[] DEFAULT '{user}'
CREATE INDEX idx_users_roles ON users USING GIN(roles);

-- coaches table — links a coach record to a WeChat identity
-- channel is NOT stored here; always derived from users.channel_id
user_id TEXT NOT NULL UNIQUE REFERENCES users(user_id);
group_id INTEGER REFERENCES coach_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_coaches_user_id ON coaches(user_id);
```

A coach's channel is always `users.channel_id` for the linked `user_id`. The `coaches` table has no `channel_id` column — it was dropped in `migration_coaches_drop_channel_id.sql` to eliminate a sync bug where changing a user's channel left the coach record pointing at the old channel.

Migrations: `src/schemas/migration_add_roles.sql`, `src/schemas/migration_coaches_drop_channel_id.sql`

Superadmin seed (Pin + echo):
```sql
UPDATE users SET roles = '{user,superadmin}' WHERE user_id IN ('795fbe18', '37c8774e');
```

## How roles are assigned

- **`user`** — set automatically on registration; always present.
- **`coach`** — set automatically when a coach record is created/updated with a `user_id` FK (via `POST /coaches` or `PUT /coaches/:id`). Removed automatically if the coach record is unlinked and no other coach record references that `user_id`.
- **`admin`** — set manually via the superadmin panel's role management modal.
- **`superadmin`** — set manually via DB or the superadmin panel.

## Login flow

`POST /wx-login` returns:
```json
{
  "user": { "user_id": "…", "roles": ["user", "coach"], … },
  "channel": { "name": "Nanovate", "logo_url": "…" },
  "coach": { "id": 3, "name": "Dr. Li", … }  // null if not a coach
}
```

The mini-app stores all three in `app.globalData` and local storage (`nano_user`, `nano_channel`, `nano_coach`).

## Mini-app navigation

`pages/main/main.js` computes three boolean flags from `user.roles` on `onLoad`:

```js
const isCoach      = roles.includes('coach')
const isAdmin      = roles.includes('admin') || roles.includes('superadmin')
const isSuperadmin = roles.includes('superadmin')
```

The header menu renders links conditionally:
- **Coach Panel** — visible when `isCoach`
- **Channel Admin** — visible when `isAdmin`
- **Super Admin** — visible when `isSuperadmin`

## Role gates on page load

Each role-restricted page checks on `onLoad` and redirects back if the user lacks the required role:

```js
// pages/admin/admin.js
if (!roles.includes('admin') && !roles.includes('superadmin')) {
  wx.showToast({ title: '无权限', icon: 'none' })
  wx.navigateBack()
  return
}

// pages/coach/coach.js
if (!roles.includes('coach') && !roles.includes('admin') && !roles.includes('superadmin')) { … }

// pages/superadmin/superadmin.js
if (!roles.includes('superadmin')) { … }
```

## Channel scoping

- `pages/admin/admin` loads data via `/channel-users/:channelId` and `/channel-coaches/:channelId` — scoped to `user.channel_id`.
- `pages/superadmin/superadmin` loads from `/users` and `/coach-list` — all channels.

## Worker API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channel-users/:id` | All users in a channel |
| `GET` | `/channel-coaches/:id` | All coaches in a channel (resolved via `users.channel_id`) |
| `GET` | `/coach-users/:id` | Clients assigned to a specific coach |
| `PUT` | `/users/:id` | Accepts optional `roles` array to update roles |
| `POST` | `/coaches` | Accepts `user_id`, optional `group_id`; auto-grants `coach` role |
| `PUT` | `/coaches/:id` | Accepts `user_id`, optional `group_id`; syncs `coach` role on old/new linked user |
