---
name: gcn-integration
description: Reference for the nano<->GCN (Aeviva partner storefront) cross-repo integration — webview token exchange, partner provisioning, the partner-system consolidation (GCN now owns tier catalog/assignment/referral-tree/commission as of 2026-08-09), and the web/miniapp admin embed. Load when touching any of these endpoints, the GCN sibling repo, or aeviva-channel storefront/inventory code.
---

The `aeviva` nano channel has a partner/distributor program (`docs/architecture/partner-system.md`, tables `partners`/`partner_commissions`) whose storefront, wholesale/resale inventory, and manual-QR checkout are implemented in a **separate sibling repo**, `/Users/pin/waven/gcn` (GCN — see its own `CLAUDE.md`). **As of 2026-08-09 (all 5 phases of the consolidation roadmap, shipped) this is no longer accurate as a description of who owns what** — GCN, not nano, is now the source of truth for partner tier catalog/assignment, the referral tree, and referral/sales/team-income commission math. See "Partner-system consolidation" below for the full mechanics; the rest of this paragraph describes what's still true. Nano remains where new recruitment edges are actually *created* (its own admin panel / self-service apply flow) and pushes them to GCN, and nano still owns end-user identity/auth. GCN owns its own storefronts (`partners`/`referral_codes`/`partner_inventory`), its own order/commerce engine, and — since 2026-07-16 — its own parallel, independently-configurable platform-economics settlement/dividend rules (`sector_settlement_rules`/`sector_dividend_tiers`, seeded for aeviva alongside tea) — that piece was never nano's and is unaffected by the consolidation.

**GCN store provisioning is explicit, not login-implicit.** A GCN `partners` row for an aeviva partner is created only via nano's admin panel ("Provision GCN Store" button in the Partners tab, gated to GCN-linked channels) calling `POST /api/auth/partners/nano/provision` on GCN — GCN's own OTP login (`handleOTPVerify`'s aeviva branch) no longer calls nano or creates/mutates a partner row itself; it only checks one was already provisioned, rejecting login otherwise. This replaced the old flow where GCN called nano's `by-phone` lookup and silently created/refreshed the partner row on every login attempt.

**Before changing any of the following, check GCN's usage first** (`grep -rn <endpoint> /Users/pin/waven/gcn/src/functions/`) — these are server-to-server contracts GCN depends on, not just internal nano routes:

| Nano endpoint | Called by (GCN) | Purpose |
|---|---|---|
| `POST /api/webview-token` | miniapp (`appview.js`) | mints a one-time `wvt` before opening the aeviva GCN webview |
| `POST /api/exchange-webview-token` | `gcn/src/functions/auth/index.js` `handleNanoSSO` | exchanges `wvt` → nano user identity (phone) for GCN's consumer SSO bridge |
| `POST /api/partner-sales` | **No longer called by GCN as of Phase 4 (2026-08-09).** Was: `handleCommissionReport` draining the `commission_reports` outbox on every confirmed GCN sale, triggering nano's `recordSalesCommission()`. GCN now computes sales-margin/team-income commission itself (`creditAevivaSalesCommission`, `mall/index.js`) instead of reporting to nano. The endpoint/handler (`handlePostPartnerSale`) and `recordSalesCommission` are left in place, just unreachable — nothing on nano's side calls `recordSalesCommission` except this one HTTP endpoint. |
| `POST /api/exchange-admin-webview-token` | `gcn/src/functions/auth/index.js` `handleNanoAdminSSO` | exchanges an admin-panel `wvt` → `{ admin_role, admin_account_id, channel_id }` for GCN's **admin** SSO bridge (distinct from the consumer bridge above) |
| `POST /api/partner-children-gcn` | **Not actually called by GCN** — found stale during the Phase 3 audit. `handleGetNetworkChildren`'s own docstring (and this file, previously) described it as relaying here, but the GCN code had already become a fully local recursive query at some earlier, undocumented point — this row is kept only as a record of what the (inaccurate) contract used to claim; treat this endpoint as dead from GCN's side unless something changes that. |
| `POST /partner-types-gcn-sync` | `gcn/src/functions/mall/index.js` `syncPartnerTypeToNano`, called from `handlePostPartnerType`/`handlePutPartnerType`/`handleDeletePartnerType` (GCN's admin Wholesale Rules panel) | pushes `{action, type_id, label_zh, label_en, tier_rank, entry_fee, is_active}` **into** nano — see "Partner-system consolidation" below, this and the row below are the only calls in this table that run GCN → nano rather than nano → GCN |
| `POST /partner-tier-assignment-gcn-sync` | `gcn/src/functions/auth/index.js` `syncTierAssignmentToNano`, called from `handleAdminAssignAevivaTier` (`PUT /api/auth/admin/partners/:id/tier`) | pushes `{nano_partner_id, tier}` **into** nano — per-partner analog of the row above, see "Partner-system consolidation" below |

These are gated by a **scoped** nano<->GCN service token (`worker/index.js`'s `GCN_ALLOWED_PATHS` allowlist, env var `GCN_API_TOKEN` on nano's side / `NANO_API_TOKEN` on GCN's — same value, different var names per side) — no longer nano's superadmin `API_BEARER_TOKEN`, which GCN previously held unscoped access via. The reverse direction (nano calling GCN's new provisioning endpoint) uses a separate scoped credential, `GCN_SERVICE_TOKEN` (nano) / `NANO_SERVICE_TOKEN` (GCN). `GET /api/partners/by-phone/:phone?channel=aeviva` still exists in nano (`handlers/partners.js`) but is no longer part of the cross-repo contract — nano's own provisioning handler reads its local `partners` table directly instead of calling its own API.

### Partner-system consolidation: GCN owns tier catalog, assignment, referral tree, and commission (all 5 phases, shipped 2026-08-09)

For the three GCN-linked tiers (`light_entrepreneur`/`leader_partner`/`operations_center`),
`partner_types.managed_by_gcn` (`migration_partner_types_gcn_managed.sql`) is `TRUE`, and nano's
own admin panel (`PartnersTab.jsx`) renders `label`/`label_zh`/`entry_fee`/`is_active`
**read-only** for these rows — `handlePutPartnerType` (`handlers/partners.js`) nulls out any
attempt to change them server-side too, pointing the operator at GCN's Wholesale Rules panel
instead. `color`/`sort_order`/`description` remain nano-local and freely editable (cosmetic/
local-reorder concerns with no GCN-side equivalent). GCN pushes the current
`label_zh`/`label_en`/`tier_rank`/`entry_fee`/`is_active` on every edit via
`handleGcnSyncPartnerType` (this file's `POST /partner-types-gcn-sync` handler), which upserts
into nano's `partner_types` with `managed_by_gcn = TRUE`.

**Tier *assignment*** (which tier a specific partner holds, `partners.tier`) is now also
GCN-driven, per-partner: `handleGcnSyncPartnerTierAssignment` (this file's
`POST /partner-tier-assignment-gcn-sync` handler) sets `partners.tier` + a new
`tier_managed_by_gcn` column (`migration_partner_types_full_gcn_sync.sql`). `handlePutPartner`
guards its `UPDATE` with `tier = CASE WHEN tier_managed_by_gcn THEN tier ELSE $1 END` — once GCN
has assigned a partner's tier, nano's own Edit Partner tier `<select>` (`PartnersTab.jsx`) goes
read-only for that row and any direct API write is silently ignored server-side too, no separate
read-then-branch race window. `handlePostPartnerGcnProvision`/`syncGcnPartnerStatus` (below) keep
sending `tier: partner.tier` on every provision/re-sync exactly as before — harmless, since GCN's
own `upsertDirectStorePartner` applies the identical CASE guard on its side and simply ignores the
incoming value once it owns that partner's tier.

**Referral tree (Phase 3).** Nano is still where a new recruitment edge (`referred_by_partner_id`)
actually gets created — that hasn't moved. What changed: `handlePostPartnerGcnProvision` and
`syncGcnPartnerStatus` now also send `referred_by_partner_id` (nano's own integer id) and
`entry_fee_paid` on every provision/re-sync call. GCN resolves that nano id to its own local
`partner_id` (via `nano_partner_id`) and stores it in a **new** column,
`partners.aeviva_upline_partner_id` — deliberately not GCN's `parent_partner_id`, which is already
live for two *other* hierarchies on GCN's side (tea's dividend-pool tree, aeviva's own
store-recruits-store self-service flow) and would have created real ambiguity if reused a third
time. GCN's own Network panel (`handleGetNetworkChildren`/`handleGetNetworkInventory`) now queries
this column directly for nano-tier partners instead of relaying to nano at all — see the
`POST /api/partner-children-gcn` row above, which turned out to already be dead before this work
even started.

**Commission computation (Phase 4).** GCN ported `resolveRate()` and the live
`partner_commission_rules` rate data verbatim into its own `partner_commission_rules` table, and
now computes and pays both referral commission (at provisioning time, once — see
`creditAevivaReferralCommission` in GCN's `auth/index.js`) and sales-margin + team-income
commission (per order, inline in `handleOrderConfirmPayment` — `creditAevivaSalesCommission`,
`mall/index.js`) itself, crediting its own `ledger` table. This is why the `POST /api/partner-sales`
row above is now dead — GCN no longer reports sales to nano at all. **To prevent double-payment**,
nano's own `recordReferralCommission` call sites in `handlePostPartner` and `handlePutPartner`
(`handlers/partners.js`) are commented out, not deleted — confirmed safe first: `aeviva-china` is
the only nano channel with any partner data, so this can't silently break some other channel's
independent commission flow. `recordSalesCommission` needed no code change on nano's side at all,
since its only real-world caller was the now-unreachable `/api/partner-sales` endpoint.

**Known, accepted timing change**: nano's old referral-commission trigger was a partner's
pending→active transition (self-applied invite-code partners, `handleGcnPartnerApply` →
`handlePutPartner`). GCN's trigger is whenever that partner is actually provisioned/re-synced to
GCN, which is a separate, later admin action (`handlePostPartnerGcnProvision`) — so a referral
commission can now lag behind activation by however long it takes someone to click "Provision GCN
Store." Not a bug; just worth knowing if a referral commission seems delayed.

Full writeup, including the live end-to-end verification against aeviva-dev (exact rate-table
amounts confirmed to the cent, re-sync-doesn't-double-pay confirmed, zero `commission_reports`
rows confirmed for a test order):
`/Users/pin/waven/gcn/docs/aeviva/10-partner-system-consolidation-roadmap.md`.

**Phase 5 (shipped same day)**: originally meant to wait until Phases 3-4 had run in production
for a while — the user chose to proceed immediately instead. Turned out "drop nano's local data"
wasn't safe or even correctly scoped: `partners.tier` is `NOT NULL` with a live FK to
`partner_types(key)`, so dropping the catalog rows would break nano's own schema for no benefit;
`referred_by_partner_id` was never meant to retire (nano still creates new recruitment edges, see
above). What actually shipped:

- **Backfilled `tier_managed_by_gcn = TRUE`** (`migration_partners_tier_gcn_backfill.sql`) for
  every partner with `gcn_partner_id IS NOT NULL` — completes Phase 2's handoff for partners
  nobody had explicitly re-assigned via GCN's "Set Aeviva Tier" yet. A partner with no
  `gcn_partner_id` is correctly left alone — nothing else to defer to until provisioned.
- **Found and disabled a live, ungated commission-rules editor** — `PartnersTab.jsx`'s "Rules"
  subtab (`GET/PUT /api/partner-commission-config`, distinct from the `/api/partner-commission-rules`
  REST endpoints — this one is a JSON-shim UI, not those) had a fully working Save button editing
  the exact rate data GCN's Phase 4 port was sourced from, with **zero awareness that nano's own
  `recordReferralCommission`/`recordSalesCommission` (the only code that ever read it) are now
  disabled.** Editing it silently did nothing to any real payout — worse than merely redundant.
  Every input is now `disabled`, the Save button is gone, and a banner points to GCN's Wholesale
  Rules panel. Kept visible (not hidden) for historical/reference value. `ChannelTab.jsx`'s
  separate, generic per-channel commission-rules CRUD (`ChannelConfigModal`, gated behind
  `channels.can_customize_partner_system`) was left alone — confirmed `FALSE` on every channel
  including aeviva-china, so it's dormant/unreachable in practice, and it's not aeviva-specific
  infrastructure to begin with.
- **Deliberately not touched**: partner creation/list, commission *history* viewing, payout
  generation (`FinanceTab.jsx`) — all still legitimately nano's.

Full rationale: `/Users/pin/waven/gcn/docs/aeviva/10-partner-system-consolidation-roadmap.md`.

### Store owner substore tree (2026-07-18, superseded 2026-08-09 — see Phase 3 above)

**This section describes the pre-consolidation design and is kept for history only.** Any aeviva
store owner can recruit sub-stores, and each sub-store can recruit its own — an unbounded-depth
downline. Until Phase 3, this lived exclusively in nano's `partners.referred_by_partner_id`, with
`handleGcnPartnerChildren` (`worker/handlers/partners.js`) doing both the tree walk and the
ancestry-authorization check, and GCN's `handleGetNetworkChildren` acting as a thin proxy
(`POST /api/partner-children-gcn`) that relayed every read through nano.

**As of Phase 3, GCN holds its own copy of this tree** (`partners.aeviva_upline_partner_id`,
backfilled once from nano's `referred_by_partner_id`) and answers `handleGetNetworkChildren`
entirely locally via a recursive CTE — no call to nano for this endpoint anymore. Nano still
creates new recruitment edges through its own admin panel / apply flow and pushes them to GCN on
provision/re-sync; `handleGcnPartnerChildren`/`/api/partner-children-gcn` itself is dead code on
nano's side now that GCN no longer calls it, not yet removed. `dashboard-channel.html`'s Network
panel still renders as the same lazy, one-level-at-a-time collapsible tree — only the data source
changed. See GCN `docs/aeviva/06-nano-integration.md`'s "Referral tree" section for the current
mechanics.

**Dev sandbox gotcha (also stale as written)**: this used to describe a 5-phone GCN sandbox with
hardcoded `nano_partner_id`s 990001/990002 that don't exist in nano's own `partners` table by
default. The sandbox has since grown to 10 phones (GCN `CLAUDE.md`'s "Aeviva development sandbox"
section has the current roster); the underlying gotcha — GCN-side placeholder `nano_partner_id`s
with no matching nano row unless separately seeded via `nano/temp/seed-sandbox-partner-tree.js` —
still applies to the Parent Store (Operations Center) phone specifically, since it's the only
sandbox partner GCN's `aeviva_upline_partner_id` tree actually has a downline for (Child Store).

GCN sets its own `partners.partner_type` directly to the real nano tier key (`light_entrepreneur`/`leader_partner`/`operations_center`, already-seeded `partner_types` rows) at provisioning time — it no longer hardcodes `partner_type='store'` with the real tier stashed in `metadata.nano_tier`. Tier/status changes on nano's side take effect the moment an admin next saves or deactivates the partner in nano's Partners tab (not automatically on GCN login, since login no longer touches nano) — see the 2026-07-29 fix below for how that re-sync actually reaches GCN.

**2026-07-29 bug, now fixed: a nano-side status change (e.g. deactivating a channel partner) never reached GCN once a store already existed there.** Reported for `aeviva-china`, but the bug was channel-agnostic. Root cause: nano's *only* code that ever called GCN's provisioning endpoint was `handlePostPartnerGcnProvision` (`POST /api/partners/:id/gcn-provision`, the "Provision GCN Store" button) — and that button is permanently replaced by a static "Provisioned" badge the moment `gcn_partner_id` is set (`PartnersTab.jsx`), with no other UI affordance to re-trigger it. Neither the Edit Partner save (`handlePutPartner`) nor the Deactivate quick-action (`handleDeletePartner`) ever called GCN at all — they only ever wrote nano's own `partners` row. Separately, even a manual re-call would have been a no-op for a deactivation: `upsertDirectStorePartner` (GCN `auth/index.js`) hardcoded `status = 'active'` on both its insert and update branches, so GCN could never be told a partner was no longer active.

**Fix:** `handlers/partners.js` gained `syncGcnPartnerStatus(partner)`, called from both `handlePutPartner` and `handleDeletePartner` (not just the original provision button) whenever `gcn_partner_id` is already set — best-effort, non-blocking (a GCN outage surfaces as `gcnSyncError` in the response, surfaced as an `alert()` in `PartnersTab.jsx`, but never fails the nano-side write that already committed). It re-POSTs to the same `/api/auth/partners/nano/provision` endpoint, now including `status`, mapped via `NANO_TO_GCN_STATUS` (nano's `pending`/`active`/`inactive` → GCN's `pending`/`active`/`suspended` — `inactive` deliberately maps to `suspended`, not `exited`, since a nano-side deactivation should block store/login access, not permanently sever the record). On GCN's side, `upsertDirectStorePartner` and `handleNanoProvisionPartner` now accept and write through a real `status` (validated against GCN's `pending`/`active`/`suspended`/`exited` CHECK constraint) instead of hardcoding `'active'` — the two login-time callers (`finalizeSectorLogin`, `handleNanoSSO`) are unaffected since they only ever upsert when nano has already confirmed a partner active, and the `status` param defaults to `'active'` for them.

No changes were needed to GCN's login-time gating (`finalizeSectorLogin`'s `isProvisionedPartner` check) — it already treated any non-`'active'` local partner status as "not provisioned," re-checking nano and falling through to a `403` if nano didn't confirm the partner active either. That path just never used to receive the deactivation signal in the first place. **Known gap:** any partner desynced *before* this fix shipped stays stale until its next edit/deactivate in nano — no backfill was run to force-resync existing GCN rows.

Files: nano `handlers/partners.js` (`NANO_TO_GCN_STATUS`, `syncGcnPartnerStatus`, wired into `handlePutPartner`/`handleDeletePartner`), `src/web/admin-panel/src/tabs/PartnersTab.jsx` (`gcnSyncError` surfaced via `alert()` in `savePartner`/`deactivatePartner`); GCN `src/functions/auth/index.js` (`upsertDirectStorePartner`'s `status` param, `handleNanoProvisionPartner`'s `status` body field + validation).

### Web Admin Panel entry point: GCN-linked channels' Inventory tab

Channels with a GCN sector (aeviva/aeviva-china today) have their **wholesale/retail product commerce** — product/SKU catalog, per-partner stock (`products`/`skus`/`partner_inventory`), and order shipping — run entirely in GCN, genuinely independent of nano: suppliers create and stock products via their own GCN login (`dashboard-supplier.html`), and consumers buy through a partner's GCN storefront link, not through nano. Nano's own Inventory tab (`src/web/admin-panel/src/tabs/InventoryTab.jsx`) is inert for these channels' commerce — when the channel currently in view there (superadmin's channel-selector pick, or a channel-scoped admin's locked channel) is GCN-linked, the tab renders `GcnInventoryEmbed.jsx` — an iframe to `aeviva/dashboard-admin.html` — instead of the native items/SKUs/orders/warehouses sub-tabs. Gating is channel-based, not role-based: a superadmin viewing aeviva sees the same embed a locked-in aeviva channel admin does. Inside that embed, admin-role cross-partner product/stock CRUD and order shipping/tracking are real GCN features (`gcn/src/functions/mall/index.js`'s `handleAdminProductList`/`handleAdminProductCreate`/`handleAdminInventoryAdjust`/`handleAdminOrderList`/`handleOrderShip`/`handleOrderComplete`) — not a nano proxy. GCN products can have parent-child SKU variants (size/color/etc.), a feature ported from nano's own SKU variant system (`migration_sku_variants.sql`) into GCN's `mall/index.js` and admin/supplier/consumer UI — see GCN `CLAUDE.md`'s "Parent-Child SKU System" section; nano's own SKU variants are unrelated/unaffected by this port.

For a channel-scoped admin (not superadmin) locked into a GCN-linked channel, this nav item is relabeled **"GCN"** instead of "Inventory" (`App.jsx`'s `inventoryLabel`, keyed off `session.channelId` → the channel's `key_name` — superadmin's label stays generic since their in-tab channel selector isn't known at the nav level). The same condition (`isGcnEmbedTab`) also strips `.content`'s normal page padding/border-radius (`content--full-bleed` class in `style.css`) so the iframe fills the panel edge-to-edge instead of floating in a padded box, and adds the Aeviva channel logo (`session.channelLogo`) to nano's own topbar next to the "GCN" title. The iframe itself uses `flex: 1` (not a fixed `calc(100vh - Npx)`) to fill available height — a hardcoded offset drifts out of sync with actual chrome height and leaves blank space. GCN's own side of this — collapsing its left sidebar into a top bar when it detects it's iframed, hiding its own logo/sign-out since nano's chrome already covers that — is documented in GCN `CLAUDE.md`'s "Embedded mode" section.

`dashboard-admin.html`'s "商城商品" (Store Products) panel — the same GCN-linked-channel Inventory tab embed above — used to be a read-only mirror of nano's own **Waven Dots** cartridge line (§14, `channel_inventory_items`, via a `handleAdminNanoStoreItems` proxy to nano's `/api/store-items/by-channel`). That proxy has been removed (2026-07-16): "商城商品" is now just the label for the same GCN-native `handleAdminProductList`/create/stock-adjust surface described above — there is no nano-sourced product data anywhere in `dashboard-admin.html` anymore. Waven Dots (§14) remain a distinct, nano-owned physical product line sold through nano's own miniapp/native store — unrelated to aeviva's GCN commerce, and no longer surfaced in GCN's admin console at all.

The same embed also has a "结算规则" (Settlement Rules) panel (`GET`/`PUT /api/mall/settlement/rules`, `handleSettlementRules`/`handlePutSettlementRules` in `gcn/src/functions/mall/index.js`) — GCN's own configurable platform-economics split (supplier/store/county/regional/ecosystem pool percentages + dividend tiers), admin-only, entirely GCN-native. This is a separate, parallel revenue split GCN runs on its own commerce (`sector_settlement_rules`/`sector_dividend_tiers`, previously only seeded for `tea`, deliberately unseeded for aeviva, then retired for aeviva entirely by migration_0029 in favor of wholesale-tier rules) — distinct from referral/sales-margin/team-income commission math. That commission math itself is, as of 2026-08-09, **also GCN-native** (`partner_commission_rules` ported into GCN, computed in `mall`/`auth` — see "Partner-system consolidation" above); nano's own `partner_commission_rules`/Partners-tab "Rules" subtab is now a disabled, read-only historical view, not a live source of truth.

This uses a **separate** SSO bridge from the consumer one above (`POST /api/admin-webview-token` → `POST /api/exchange-admin-webview-token`, `src/functions/worker/handlers/login.js`), because nano's web admin panel session model differs from the miniapp's: a superadmin login returns the literal `API_BEARER_TOKEN` as its bearer (no per-user identity — every superadmin request looks identical server-side), while a channel-scoped admin's `ch.`-prefixed token does carry a real `admin_accounts.id`. GCN's `handleNanoAdminSSO` reflects this: it upserts a `users` row keyed by `nano-admin:${admin_account_id}` for a real channel admin, or the shared placeholder `nano-admin:superadmin` for the anonymous superadmin case, forcing `role='admin'` directly rather than deriving it from partner status — no `partners` row is created (an admin isn't a storefront member). Token minting itself re-validates the channel is GCN-linked server-side (`GCN_LINKED_CHANNEL_KEYS` in both `login.js` and `InventoryTab.jsx`) — the frontend gate is not trusted alone.

Miniapp entry point: for aeviva-channel users, tapping the **Store tab** button (`pages/main/main.js` `switchTab`) intercepts before switching `tab`, and instead calls `_openAevivaStore()` → `openUserApp()` → `wx.navigateTo` to `pages/appview/appview.js` (generic webview launcher — mints the `wvt` itself, supports both nano-relative and absolute external URLs) → `https://aeviva(-dev).gcn.net/dashboard.html` (direct hostname — only this domain has WeChat business-domain verification hosted, not `edge(-dev).gcn.net`). **Not** rendered inline inside the Store tab's own section — `<web-view>` doesn't reliably support any overlay back button (`cover-view` is only documented for `map`/`video`/`canvas`/`camera`, not `web-view`) when embedded inside `main.wxml`'s absolutely-positioned tab-switching containers; confirmed by live testing, not just platform docs. `main.wxml`'s `store-tab` section itself has no aeviva-specific branching — `tab` is simply never set to `'store'` for aeviva users, so it always renders the native dots/credits store underneath (harmlessly unused for them).

**`handleNanoSSO` hard-requires a verified phone** (`phone_verified` from nano's `WEBVIEW_USER_SELECT`, i.e. `users.phone_verified_at IS NOT NULL`) — a WeChat-openid-only account with no verified phone gets a `403 phone_not_verified` from GCN, since a GCN account must be backed by a real phone (see "GCN account must be backed by a real, OTP-verified phone" above). Phone verification is otherwise **never a standing gate** anywhere else in nano (`login.js`'s explicit design note — WeChat mini-program review requires free browsing), so most accounts reach this flow unverified. `switchTab` checks `user.phone_verified` **before** calling `_openAevivaStore()` and shows a confirm dialog routing to `pages/verify-phone/verify-phone` (no `?new=1`, so it skips the avatar-capture step and its cancel button won't delete the account — that page's `showAvatarStep`/`handleLogout` guards are both keyed off that param) instead of opening a webview that would just dead-end on GCN's login page with no explanation. `main.js`'s `_initChat` also shows a one-time-per-session, non-persisted chat nudge (`t.verifyPhonePrompt` + an action button) for any unverified user on load, independent of channel — advisory only, never blocking, per the same free-browsing constraint.

**2026-07-27 bug, now fixed:** this whole handoff silently 500'd/401'd in prod for months behind three unrelated, independent gaps that only surfaced once someone actually exercised the full path — see gcn `CLAUDE.md`'s Known Issues entry for the same date. Worth remembering when this flow acts up again: reproduce it directly (mint a real `wvt` via `POST /api/webview-token`, exchange it via `POST https://aeviva(-dev).gcn.net/api/auth/sso/nano`) rather than trying to infer the cause from a WeChat DevTools screenshot alone — none of the three failure modes (wrong domain, missing nano-side token, missing gcn-side table) look different from the user's side, all of them just dead-end on GCN's login page.
