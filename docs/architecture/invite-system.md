# Invite System

Invite codes are the sole mechanism for onboarding new users into a channel. They also serve as the attribution anchor for the commission system.

---

## How it works

1. A coach or admin generates an invite code (`POST /api/invitations`). The code is a random 6-digit number.
2. The coach shares the code or a deep-link: `pages/login/login?invite={code}`.
3. When a new user signs in with the code, their `channel_id` and `coach_id` are assigned from the invitation, and `users.invited_by_invitation_id` is set.
4. When an existing user with no channel redeems a code, the same assignment happens.
5. Each redemption writes a row to `invitation_uses`.

---

## Database schema

### `invitations`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | Primary key |
| `code` | TEXT UNIQUE | 6-digit numeric string |
| `created_by` | TEXT FK → `users.user_id` | SET NULL on user deletion |
| `created_by_snapshot` | TEXT | Copy of `created_by` at creation; no FK; permanent |
| `channel_id` | INTEGER FK → `channels.id` | CASCADE on channel deletion |
| `type` | TEXT | `'coach'` or `'channel'` |
| `max_uses` | INTEGER | NULL = unlimited |
| `use_count` | INTEGER | Incremented on each redemption |
| `expires_at` | TIMESTAMPTZ | NULL = no expiry |
| `is_active` | BOOLEAN | FALSE = soft-deleted |
| `created_at` | TIMESTAMPTZ | |

### `invitation_uses`

One row per redemption. This table is the permanent audit log of who used which code.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | Primary key |
| `invitation_id` | BIGINT FK → `invitations.id` | CASCADE on invite deletion |
| `user_id` | TEXT FK → `users.user_id` | SET NULL on user deletion (row is kept) |
| `user_id_snapshot` | TEXT | Copy of `user_id` at redemption; no FK; permanent |
| `used_at` | TIMESTAMPTZ | |

Unique constraint: `(invitation_id, user_id_snapshot)`.

### `users.invited_by_invitation_id`

`BIGINT FK → invitations.id ON DELETE SET NULL`. Points to the invitation that brought this user in. Used by the commission system for order attribution.

---

## Permanent history — snapshot columns

Two columns have no foreign key and are written once, never updated:

- `invitations.created_by_snapshot` — the `user_id` of whoever created the code, captured at creation time.
- `invitation_uses.user_id_snapshot` — the `user_id` of the redeemer, captured at redemption time.

These survive any future deletion:

| Event | Effect on FK column | Snapshot column |
|---|---|---|
| Inviter user deleted | `invitations.created_by` → NULL | `created_by_snapshot` unchanged |
| Invited user deleted | `invitation_uses.user_id` → NULL, **row kept** | `user_id_snapshot` unchanged |

Before this design was in place, deleting an invited user cascaded the `invitation_uses` row away entirely — leaving no record that they were ever invited. Now the row persists with `user_id = NULL` and the original ID in `user_id_snapshot`.

---

## Invite lifecycle

```
POST /api/invitations
  → INSERT invitations (created_by, created_by_snapshot, channel_id, ...)
  → returns { code }

User signs in with invite_code
  → validate: is_active = TRUE, not expired, use_count < max_uses
  → INSERT users (..., invited_by_invitation_id)
  → UPDATE invitations SET use_count = use_count + 1
  → INSERT invitation_uses (invitation_id, user_id, user_id_snapshot)

DELETE /api/invitations/:id
  → UPDATE invitations SET is_active = FALSE  (soft-delete, never hard-delete)
```

---

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/invitations` | Bearer | List codes. Query: `channel_id`, `created_by` |
| `POST` | `/api/invitations` | Bearer | Create code. Body: `created_by`, `channel_id`, `type`, `max_uses` |
| `DELETE` | `/api/invitations/:id` | Bearer | Deactivate (soft-delete) |
| `POST` | `/api/validate-invite` | None | Check code validity before signup. Body: `invite_code` |

The `GET` response includes `creator_name` (the inviter's nickname). If the inviter has been deleted, it falls back to `created_by_snapshot` so the admin panel always shows something meaningful.

---

## Commission attribution

The invite is the attribution anchor for the entire commission system. See [rewards-system.md](rewards-system.md).

- `invitations.created_by` → identifies the earning coach
- `invitations.channel_id` → identifies the earning channel (snapshotted at invite creation, so channel transfers are handled automatically)

---

## Migration

`src/schemas/migration_invite_history.sql` — adds the snapshot columns, changes `invitation_uses.user_id` FK from `CASCADE` to `SET NULL`, backfills existing rows, and replaces the unique index.

Original schema: `src/schemas/migration_add_invitations.sql`
