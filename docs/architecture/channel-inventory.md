# Channel Inventory System

Each channel in the Waven platform operates as an independent commercial entity with its own product and service catalog. The **Channel Inventory** system lets each channel manage its own list of items — both physical goods (supplements, test kits) and virtual services (health checkups, coaching sessions, digital products) — separately from the global platform store.

---

## Concepts

### Channel Inventory vs Global Store

| | Channel Inventory | Global Store |
|---|---|---|
| Table | `channel_inventory_items` | `store_items` |
| Scope | Per-channel | Platform-wide |
| Who manages | Superadmin or channel admin | Superadmin only |
| Use case | Channel-specific products & services | Waven-branded products (Kino chips, Dots subscriptions) |
| Order system | Not yet — inventory catalogue only | `orders` table with full order lifecycle |

### Item Types

Each inventory item has an `item_type` of either:

- **`physical`** — tangible goods: supplement packs, test kits, printed vouchers, etc.
- **`virtual`** — intangible services: health checkups, coaching sessions, digital access passes, subscriptions

The distinction is informational at this stage; it drives the badge display in the admin panel and can be used by future ordering or fulfilment logic to route items differently.

### Stock Quantity

`stock_quantity` is an optional integer:

- **`NULL`** — unlimited stock (default for virtual items and open-ended physical goods)
- **integer ≥ 0** — tracked quantity; shown as-is in the admin panel

The system does not currently auto-decrement stock on purchase — that would require linking channel inventory to an order flow. Stock quantity is managed manually by the channel admin.

---

## Database

**Migration**: `src/schemas/migration_channel_inventory.sql`

**Table**: `channel_inventory_items`

| Column | Type | Description |
|---|---|---|
| `id` | UUID PK | Primary key |
| `channel_id` | INTEGER FK | References `channels(id)`, cascades on delete |
| `key_name` | TEXT | Machine identifier, unique per channel (e.g. `health-checkup-basic`) |
| `name_en` | TEXT | Display name in English |
| `name_zh` | TEXT | Display name in Chinese |
| `desc_en` | TEXT | Short description in English |
| `desc_zh` | TEXT | Short description in Chinese |
| `item_type` | TEXT | `physical` or `virtual` |
| `unit_en` | TEXT | Unit label in English (e.g. "1 session") |
| `unit_zh` | TEXT | Unit label in Chinese (e.g. "1 次") |
| `price_cny` | NUMERIC(10,2) | Price in CNY (nullable) |
| `price_usd` | NUMERIC(10,2) | Price in USD (nullable) |
| `stock_quantity` | INTEGER | Available stock; NULL = unlimited |
| `tag` | TEXT | Optional badge: `bestseller`, `value`, `new` |
| `sort_order` | INTEGER | Display ordering (ascending) |
| `active` | BOOLEAN | Whether the item is publicly listed |
| `image_url` | TEXT | OSS URL of the item thumbnail |
| `metadata` | JSONB | Extensible field for item-specific config |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Uniqueness constraint**: `(channel_id, key_name)` — key names must be unique within a channel but can repeat across channels.

**Index**: `idx_channel_inventory_channel_id` on `channel_id` for fast per-channel queries.

---

## API

All endpoints require a valid admin bearer token (see role system). Channel admins are automatically scoped to their own `channel_id`; superadmins must pass `channel_id` explicitly.

### `GET /channel-inventory`

List all inventory items for a channel, ordered by `sort_order` then `created_at`.

**Query params**

| Param | Required for | Description |
|---|---|---|
| `channel_id` | Superadmin | Target channel ID |

Channel admin tokens ignore `channel_id` — the token's own channel is always used.

**Response**
```json
{
  "success": true,
  "items": [ { "id": "...", "channel_id": 1, "key_name": "health-checkup-basic", ... } ]
}
```

---

### `POST /channel-inventory`

Create a new inventory item.

**Body**

| Field | Required | Notes |
|---|---|---|
| `channel_id` | Superadmin | Ignored for channel admin tokens |
| `key_name` | Yes | Must be unique within the channel |
| `name_en` | Yes | |
| `name_zh` | No | |
| `desc_en` / `desc_zh` | No | |
| `item_type` | No | `physical` (default) or `virtual` |
| `unit_en` / `unit_zh` | No | |
| `price_cny` / `price_usd` | No | Omit or null for unpriceable items |
| `stock_quantity` | No | Omit or null for unlimited |
| `tag` | No | `bestseller`, `value`, `new`, or empty |
| `sort_order` | No | Default `0` |
| `active` | No | Default `true` |
| `image_url` | No | OSS URL; upload via `GET /api/oss/presign?category=inventory` first |
| `metadata` | No | Arbitrary JSON |

**Response**
```json
{ "success": true, "item": { ... } }
```

---

### `PUT /channel-inventory/:id`

Update an existing item. All body fields except `key_name` and `channel_id` can be updated.

Channel admins can only update items belonging to their own channel (enforced server-side by `AND channel_id = $N`).

**Response**
```json
{ "success": true, "item": { ... } }
```

Returns `404` if the item does not exist or belongs to a different channel.

---

### `DELETE /channel-inventory/:id`

Delete an item. Channel admins can only delete items from their own channel.

**Response**
```json
{ "success": true }
```

---

## Admin Panel

The **Inventory** tab appears in the left sidebar between **Store** and **Channels** (Archive icon).

### Superadmin view

1. A **channel selector** dropdown appears at the top. No items are shown until a channel is selected.
2. Once a channel is selected, its inventory loads with stat cards (Total / Active / Physical / Virtual).
3. The **Add Item** button opens the item modal pre-associated with the selected channel.
4. All CRUD operations apply to that channel's catalog only.

### Channel admin view

The channel selector is hidden. The tab loads the admin's own channel inventory automatically.

### Item table columns

| Column | Notes |
|---|---|
| Thumbnail | 40×40 image; falls back to a box icon placeholder |
| Name | Bold English name, Chinese name below, `key_name` in monospace |
| Type | `Physical` (blue badge) or `Virtual` (purple badge) |
| Price CNY | Formatted as `¥X.XX`; shows `—` if unset |
| Stock | Integer count or `Unlimited` if null |
| Active | Green `Yes` / grey `No` badge |
| Actions | Edit (pencil) and Delete (red trash) buttons |

### Item modal fields

All fields from the database are editable in the modal. Notable behaviours:

- **Key Name** is disabled for existing items (cannot be renamed after creation).
- **Stock Qty** — leave blank for unlimited; enter an integer to track finite stock.
- **Image upload** — uses `GET /api/oss/presign?category=inventory` to get a presigned OSS URL, then uploads the file directly to OSS before saving the item.

### Channel admin tab permissions

The **Inventory** tab is listed in the per-channel admin tab configuration (the **Admin Tabs** button on the Channels page). Superadmins can grant or revoke access to the Inventory tab for each channel's admin accounts independently.

---

## Image Uploads

Images are uploaded to Aliyun OSS under the `inventory` category:

```
GET /api/oss/presign?type=image&filename=<name>&category=inventory
→ { url: "<presigned PUT URL>", get_url: "<public GET URL>" }
```

Upload the file to `url` via PUT, then store `get_url` as `image_url` on the item.

---

## Extending the System

**Adding order support**: Create a `channel_inventory_orders` table that references `channel_inventory_items.id` (similar to `orders` → `store_items`). The API handlers and admin panel can then follow the same pattern as the existing Store tab.

**Auto-decrementing stock**: On order confirmation, decrement `stock_quantity` with an `UPDATE ... WHERE stock_quantity IS NOT NULL AND stock_quantity > 0`.

**Virtual item fulfilment**: Use the `metadata` JSONB column to store fulfilment details (e.g. appointment booking URLs, access codes, external system IDs).
