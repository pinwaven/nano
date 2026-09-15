'use strict';

// Channel-tree helpers. `channels` is a tree via parent_channel_id (migration_multi_tier_channels)
// — today `waven` (id 1) → `waven-china` → `waven-china-zj`, and `aeviva` → `aeviva-china` —
// and several rules are really about the ROOT of that tree, not the leaf a user happens to be
// on: which GCN sector a channel belongs to (sectors.owner_nano_channel_id is the root key),
// and whether email login is offered (a waven-china-zj user is a Waven user). GCN's
// handleNanoSSO reads the root as `channel.root_key_name` on the webview-token exchange and
// refuses a cross-channel login when it disagrees with the sector's owner, so this must never
// return the leaf key for a sub-channel.

const { pool } = require('./db');

// Walks parent_channel_id up to the top and returns that channel's key_name; null for a
// null/unknown channel. Bounded by the recursive CTE's own cycle guard (depth cap) so a
// mis-parented row can never loop.
async function resolveRootChannelKey(channelId, db = pool) {
    if (channelId === null || channelId === undefined) return null;
    const { rows } = await db.query(
        `WITH RECURSIVE up AS (
             SELECT id, key_name, parent_channel_id, 1 AS depth FROM channels WHERE id = $1
             UNION ALL
             SELECT c.id, c.key_name, c.parent_channel_id, up.depth + 1
             FROM channels c JOIN up ON c.id = up.parent_channel_id
             WHERE up.depth < 10
         )
         SELECT key_name FROM up ORDER BY depth DESC LIMIT 1`,
        [channelId]
    );
    return rows[0]?.key_name || null;
}

// Channel trees with a GCN sector behind them, keyed on the ROOT channel key and mapped to
// GCN's sector_id (sectors.owner_nano_channel_id is that same root key). aeviva since the
// integration began; waven since GCN migration_0113 (2026-09-15). Every "is this channel
// GCN-linked" gate — the miniapp store webview token, the chat store catalog, partner
// provisioning, the admin console embed — resolves through here so a sub-channel inherits its
// tree's sector. The web admin panel carries a client-side copy (shared.jsx).
const GCN_SECTOR_FOR_ROOT_CHANNEL = Object.freeze({ aeviva: 'aeviva', waven: 'waven' });

// The GCN sector_id for a channel id, or null when its tree has no GCN sector.
async function resolveGcnSector(channelId, db = pool) {
    const root = await resolveRootChannelKey(channelId, db);
    return (root && GCN_SECTOR_FOR_ROOT_CHANNEL[root]) || null;
}

module.exports = { resolveRootChannelKey, resolveGcnSector, GCN_SECTOR_FOR_ROOT_CHANNEL };
