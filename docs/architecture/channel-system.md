# Channel System

## Overview

Channels are the top-level multi-tenancy unit. Every user, coach, Kino device, invite code, order, and inventory item belongs to exactly one channel. Channels support **unlimited-depth hierarchies**: a channel can have sub-channels, which can have sub-sub-channels, and so on. There is no hard cap on depth — a cycle guard of 20 hops is enforced in recursive queries.

---

## Database schema

### `channels`

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL | Primary key |
| `key_name` | TEXT UNIQUE | URL-safe identifier, immutable after creation |
| `name` | TEXT | Display name |
| `logo_url` | TEXT | OSS-hosted image URL |
| `config` | JSONB | Per-channel settings (see below) |
| `parent_channel_id` | INTEGER FK → `channels.id` | NULL = top-level. SET NULL on parent delete |
| `can_manage_subchannels` | BOOLEAN | Whether this channel's admin may create/manage sub-channels |
| `commission_config` | JSONB | Commission rates for the rewards system |
| `created_at` | TIMESTAMPTZ | |

Index: `idx_channels_parent` on `parent_channel_id`.

### `config` JSONB keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `persona_type` | TEXT | `'nano'` | AI persona: `'nano'` or `'viva'` |
| `admin_tabs` | TEXT[] | `[]` | Tabs visible to this channel's admin |
| `credit_exchange_rate` | FLOAT | `1.0` | Credits per CNY |
| `currency` | TEXT | `'CNY'` | Display currency |
| `sub_age_labels` | OBJECT | `{}` | Per-dimension display name overrides |

### `admin_accounts`

Separate credential store for web admin panel logins. Not linked to WeChat users.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL | Primary key |
| `username` | TEXT UNIQUE | Login name |
| `password_hash` | TEXT | `salt:scrypt_hex` |
| `channel_id` | INTEGER FK → `channels.id` | NULL = superadmin |
| `permissions` | TEXT[] | Per-account tab overrides (intersected with channel's `admin_tabs`) |

---

## Hierarchy and ownership

The self-referential `parent_channel_id` FK allows arbitrary depth. The tree is traversed with a **recursive CTE** (depth-limited to 20 to guard against cycles):

```sql
WITH RECURSIVE subtree AS (
    SELECT id, 0 AS depth FROM channels WHERE id = $root
    UNION ALL
    SELECT c.id, s.depth + 1 FROM channels c
    JOIN subtree s ON c.parent_channel_id = s.id
    WHERE s.depth < 20
)
SELECT * FROM subtree;
```

### `can_manage_subchannels` flag

When `true` on a channel, its admin account is elevated to a **CMS admin**:

- Can see their own channel and all descendants in the Channels tab
- Can create sub-channels at any depth within their subtree
- Can configure (edit, delete, grant sub-channel rights to) channels within their subtree
- Cannot touch channels outside their subtree

A CMS admin can also grant `can_manage_subchannels` to their own sub-channels, allowing delegation further down the tree. Only superadmin can grant the flag to a top-level channel.

### `verifySubchannelOwnership`

All channel-mutating handlers call this before acting on behalf of a channel admin:

```js
// Returns true if channelId is a descendant of adminCtx.channelId
async function verifySubchannelOwnership(channelId, adminCtx) {
    if (adminCtx?.role !== 'channel') return true;   // superadmin always passes
    if (!adminCtx.canManageSubchannels) return false; // non-CMS admin always fails
    // CTE check: is channelId in the subtree rooted at adminCtx.channelId?
}
```

---

## Authentication

### Superadmin

Uses the shared `API_BEARER_TOKEN` environment variable. No channel scoping.

### Channel admin (CMS admin)

`POST /api/admin-login` verifies credentials against `admin_accounts`, then issues a **signed channel admin token**:

```
ch.{base64url(payload)}.{hmac_sig}
```

Payload:
```json
{ "sub": <account_id>, "cid": <channel_id>, "tabs": ["users", "coaches", ...], "cms": true|false }
```

- `cid` — the channel this admin owns
- `tabs` — intersection of channel's `admin_tabs` and account's `permissions`
- `cms` — mirrors `channels.can_manage_subchannels` at login time

The login response also returns `channel_name` and `channel_logo` so the admin panel sidebar can show the channel's branding instead of the platform name.

The frontend stores all session data in `sessionStorage`:

| Key | Value |
|---|---|
| `nano_admin_token` | Token string |
| `nano_admin_role` | `'superadmin'` or `'channel'` |
| `nano_admin_channel_id` | Channel ID (channel admins only) |
| `nano_admin_channel_name` | Channel display name |
| `nano_admin_channel_logo` | Channel logo URL |
| `nano_admin_tabs` | JSON array of allowed tab IDs |
| `nano_admin_cms` | `'1'` if CMS admin |

---

## API endpoints

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin-login` | Authenticate and receive token |
| `GET` | `/api/channels` | List channels. Superadmin: all. CMS admin: own subtree with `depth` field |
| `POST` | `/api/channels` | Create channel. Superadmin: any parent. CMS admin: within own subtree |
| `PUT` | `/api/channels/:id` | Edit name/logo/persona/config. CMS admin: own subtree only |
| `DELETE` | `/api/channels/:id` | Delete channel. Blocked if channel has sub-channels |
| `PUT` | `/api/channels/:id/manage-subchannels` | Grant/revoke `can_manage_subchannels` |
| `PUT` | `/api/channels/:id/admin-tabs` | Set allowed tabs |
| `PUT` | `/api/channels/:id/sub-age-labels` | Override sub-age display names (superadmin only) |
| `GET` | `/api/channel-users/:id` | Users in channel. `?include_subchannels=true` → full subtree |
| `GET` | `/api/channel-coaches/:id` | Coaches in channel. `?include_subchannels=true` → full subtree |
| `GET` | `/api/admin-accounts` | List admin accounts. `?channel_id=N` to filter |
| `POST` | `/api/admin-accounts` | Create admin account |
| `DELETE` | `/api/admin-accounts/:id` | Delete admin account |

### `include_subchannels` behaviour

When `include_subchannels=true`, the query uses a recursive CTE instead of a flat `WHERE channel_id = $1`:

```sql
WITH RECURSIVE subtree AS (
    SELECT id FROM channels WHERE id = $1
    UNION ALL
    SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
)
SELECT u.* FROM users u JOIN subtree st ON u.channel_id = st.id
```

This returns users/coaches from the entire descendant tree regardless of depth.

---

## Admin panel UI

### Channels tab

Rendered by `ChannelTab` in `App.jsx`. Both superadmins and CMS admins use the same component; behaviour differs by the `isSuperadmin` flag.

**Tree display**

Channels are rendered as an indented table tree. The `expanded` set is initialized with all channel IDs so the tree is always fully open on entry. Each node can be collapsed/expanded with the `▾`/`▸` toggle.

- Superadmin: tree is rooted at `'root'` — top-level channels (those with no parent) appear at depth 0.
- CMS admin: tree is rooted at a `'cms_root'` sentinel — the admin's own channel is pinned at depth 0 regardless of where it sits in the global tree.

The `depth` field returned by the server (CMS admin path) drives indentation directly. For the superadmin path (no `depth` from server) indentation is computed client-side from `parent_channel_id` traversal.

**Per-row actions**

| Button | Icon | Who sees it |
|---|---|---|
| Add sub-channel | `+` | Everyone — opens Add Channel modal pre-filled with this row as parent |
| Settings | `⚙` | Everyone — opens unified Settings modal |

**Toolbar**

The "Add Channel" button in the toolbar is superadmin-only (for creating top-level root channels). CMS admins use the per-row `+` button instead.

### Settings modal (ChannelConfigModal)

A 6-tab unified modal replacing all per-action buttons:

| Tab | Contents | Who sees it |
|---|---|---|
| General | Name, logo, persona, exchange rate, currency, Sub-ch Management toggle | All |
| Admin Tabs | Checkboxes for allowed tab IDs | All |
| Admins | List + create/delete admin accounts | All |
| Invites | List + create/deactivate invite codes | All |
| Sub-age Labels | Override dimension display names | Superadmin only |
| Danger | Type-to-confirm delete | All (blocked if channel has sub-channels) |

The **Sub-ch Management toggle** (General tab) is shown when `canGrantSubch` is true:
- Superadmin: always true for any channel
- CMS admin: true for channels in their subtree (but not their own root channel)

### Add Channel modal (ChannelModal)

- When opened via the toolbar (superadmin only): shows a parent dropdown listing all channels with depth-based indentation.
- When opened via a row's `+` button: shows the clicked channel as a read-only parent field. `parent_channel_id` is pre-filled and not editable. `persona_type` defaults to the parent channel's persona.

---

## Delete protection

A channel cannot be deleted if it has any direct sub-channels. The constraint is enforced at two levels:

1. **Backend** (`handleDeleteChannel`): queries `SELECT 1 FROM channels WHERE parent_channel_id = $1 LIMIT 1` before the DELETE; returns HTTP 400 if any sub-channels exist.
2. **Frontend** (Danger tab): the delete button is disabled and a warning is shown when `hasSubchannels` is true.

When a channel is deleted, PostgreSQL's `ON DELETE SET NULL` on `parent_channel_id` means any orphaned sub-channels would become top-level — but the frontend/backend gate prevents this state from being reached.

---

## Migrations

| File | Purpose |
|---|---|
| `src/schemas/migration_channels.sql` | Initial `channels` table |
| `src/schemas/migration_channel_subchannels.sql` | Adds `parent_channel_id`, `can_manage_subchannels`, `idx_channels_parent` |
