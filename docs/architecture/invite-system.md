# Invite System

The platform has two distinct invite mechanisms with different creators, purposes, and commission paths.

| | Invitation Code | Referral Code |
|---|---|---|
| Created by | Coach or admin | Every user (auto-generated) |
| Purpose | Onboard a user into a specific channel | User-to-user sharing |
| Link stored on user | `users.invited_by_invitation_id` | `users.referred_by_user_id` |
| Commission earner | Coach + Channel | Referring user |
| Commission table | `coach_commissions` + `channel_commissions` | `referral_commissions` |

---

## Invitation Codes

Invitation codes are the mechanism for onboarding new users into a channel. They also serve as the attribution anchor for the coach and channel commission system.

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

---

## Referral Codes

Every user gets a permanent 6-digit numeric referral code stored in `users.referral_code`. This is the user-to-user sharing mechanism, separate from coach/admin invitation codes.

### How it works

1. A 6-digit code is generated and saved to `users.referral_code` when the user account is created.
2. The user shares their code or deep-link from the miniapp referral page: `pages/login/login?invite={referral_code}`.
3. When a new user signs up with that code, `users.referred_by_user_id` is set to the referrer's `user_id`.
4. When an existing user with no channel redeems a referral code, the same assignment happens plus the referree inherits the referrer's channel.
5. On every order the referee delivers, `recordUserReferralCommission()` fires, inserts a row into `referral_commissions`, and credits the referrer's credit ledger.

### Uniqueness guarantee

Two layers enforce that no two users share a code:

- **Application layer** — `generateReferralCode()` checks `SELECT 1 FROM users WHERE referral_code = $1` before returning a candidate. Retries up to 10 times on collision.
- **Database layer** — `users.referral_code TEXT UNIQUE` and a partial unique index (`WHERE referral_code IS NOT NULL`) reject any duplicate at write time.

### Backfill for historical users

Users created before the referral code migration have `referral_code = NULL`. The first call to `GET /api/my-referrals` auto-generates and persists a code for them in-place, so no separate migration run is needed.

### Database schema

#### `users.referral_code`

`TEXT UNIQUE` — 6-digit zero-padded string (e.g. `"042817"`). Generated by `generateReferralCode()` at account creation.

#### `users.referred_by_user_id`

`TEXT FK → users.user_id ON DELETE SET NULL` — points to the user whose referral code was used at signup. `NULL` for users who signed up without a referral link or via an invitation code path.

#### `referral_commissions`

One row per earning event per referrer. Unique on `(order_id, referrer_user_id)` — prevents duplicate commission if an order is toggled through `delivered` more than once.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `referrer_user_id` | TEXT FK | User who shared the code |
| `referee_user_id` | TEXT FK | User who was referred |
| `order_id` | UUID FK | The triggering order |
| `product_type` | TEXT | `chip`, `dot`, or `subscription` |
| `item_key` | TEXT | Denormalised from order |
| `quantity` | INT | Units ordered |
| `amount_cny` | NUMERIC(10,2) | Commission amount |
| `status` | TEXT | `pending` → `approved` → `transferred` |
| `payout_id` | UUID | FK once batched into a payout |
| `created_at` | TIMESTAMPTZ | When the order was delivered |

Commission rate: `channels.config.referral_commission_rate` (default 5%, inherits up the channel tree via the same recursive lookup used for coach/channel commissions — see [rewards-system.md](rewards-system.md)).

### API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/my-referrals` | None | `?user_id=X` — returns `referral_code`, `total_referred`, `total_commission_earned`, and a per-referral breakdown. Auto-creates `referral_code` if NULL. |

### Miniapp UI

`src/mini/nano-miniapp/pages/referral/referral.js`

- Shows the user's 6-digit code with a copy button.
- Share card generates a WeChat share message with the deep-link.
- Credit balance, withdrawal form, and withdrawal history are also on this page.

### Migration

`src/schemas/migration_user_referral_code.sql` — adds `referral_code` column with unique index and backfills all existing users.

`src/schemas/migration_user_referrals.sql` — adds `referred_by_user_id` FK and creates the `referral_commissions` table.
