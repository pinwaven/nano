# AI Store-Product Recommendation

How Viva suggests a GCN storefront's **non-Dots** products (supplements, skincare, wellness
devices) inside a health conversation — reactive only, from a reviewed per-product AI profile
authored in GCN, with the server writing the card. The rules that must hold are summarised in
`CLAUDE.md` §37; this file is the record of why.

| Neighbours | Where |
|---|---|
| The essential guardrail block this narrows, and its three-site coupling | `CLAUDE.md` §26, [../ai-persona/05-knowledge-base.md](../ai-persona/05-knowledge-base.md) |
| The `:::formula` card this borrows its "server writes the card" rule from | [dots-formulation-lifecycle.md](dots-formulation-lifecycle.md) |
| GCN's `product_ai_profiles` and `/api/mall/nano/ai-catalog` | GCN's `CLAUDE.md` |

Moved verbatim from `CLAUDE.md` §37 on 2026-09-15.

---

## 37. AI Store-Product Recommendation (aeviva-china, 2026-08-25)

Viva can suggest the Aeviva GCN storefront's **non-Dots** products (supplements, skincare,
wellness devices) inside a health conversation. Reactive only: it never volunteers one.

### The blocker was an instruction, not a gap

`llmContext` had no commerce field and `AGENTIC_TOOL_DEFS` no commerce tool, but neither mattered
— the always-injected `fact-constraint-core` block (§26) said every ingredient suggestion must
come from the Dots formulary and that **no purchase channel may ever be named**. Catalog data in
the prompt would have been refused.

That rule is **narrowed, not removed**: recommend from the Dots formulary **or** a catalog
explicitly provided in this prompt, never from training-data memory. It lives in **three places
that must change together** — the `knowledge_entries` rows (both personas,
`migration_knowledge_store_products.sql`), `lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`,
and `prompts/chat/factConstraint.js`. If the two fallbacks drift back, a transient DB error
silently returns Viva to refusing to discuss any product at all.

The company-business-info ban (prices, stock, delivery, promotions) is **untouched and still
absolute** — see "the model picks, the server writes" below for why it did not need loosening.

### AI profiles are authored in GCN, and are not the marketing copy

`products.description` already carries `zh`/`highlights_zh`/`details_zh`. **Never feed it to the
model.** It is written to convert a shopper already looking at the item; handed to a health LLM it
becomes personalized medical advice assembled out of unvetted promotional claims.

`product_ai_profiles` (GCN `migration_0079`) is the separate, reviewed record: `summary_zh`,
`indications_zh`, `key_actives_zh`, `cautions_zh`, `allergens_zh`, `evidence_level`, and
**`sub_age_targets`** using this file's §11 canonical keys. That last field is what earns the
table — it makes "which products fit this user's elevated dimension" a code filter, exactly as
`dots.sub_age_target` already does. Values are validated app-side against the fixed four.

`ai_recommendable` is **admin-only** and is rejected without a `reviewed_by` — the gate
`knowledge_entries` enforces before an entry may go active, and the precedent of
`skus.grants_partner_type` (migration_0053), the one SKU field that rejects its owning supplier.
A supplier's write omits the flag entirely rather than defaulting it false, so routine copy edits
can never silently un-approve a cleared product.

### Reactive-only is structural, not an instruction

`prompts/chat/intentClassifier.js`'s `required_data` enum gained **`store_products`**, so the
catalog is fetched only when the classifier saw the user themselves ask what they could obtain.
Every *other* pre-fetch in that bundle is unconditional precisely so a classifier miss can't blind
the model — **here a miss is the desired failure mode.** With no catalog,
`getProductRecommendBlock` returns `''`, the model is never taught the vocabulary, and the
essential block's parenthetical collapses the rule back to Dots-only. Also gated on a GCN-linked
channel (`resolveGcnSector` from `lib/channels.js`, in `handlers/chat.js` — the channel tree's GCN sector, aeviva or waven).

### The model picks, the server writes

The `recommend_product` action tail carries a `sku_id` and one sentence of reasoning and **nothing
else**. `_validateProductRecommendations` resolves each id against the snapshot the prompt was
built from — unknown ids are dropped silently, never repaired — and `_buildProductCardBlock`
(`lib/chatCards.js`, beside `_buildFormulaChartBlock` — both in `handlers/dots.js` until 2026-09-16) renders the `:::product` card from that
same snapshot. Same rule as `:::formula`: the card cannot disagree with what checkout will charge.

**Prices are deliberately never shown to the model** (`getProductRecommendBlock` omits them) — a
number it was never given is a number it cannot leak. This is why the price/stock ban above needed
no loosening.

### Allergies are a code filter, not a prompt rule

`_filterProductsByUserFacts` (`handlers/chat.js`) drops any product whose `allergens_zh`/
`cautions_zh` collide with an active `user_memory_facts` row of category `allergy` or
`dietary_restriction` (§27) **before the catalog is rendered into the prompt**, so there is nothing
left for the model to get wrong. Matching is bidirectional substring containment and deliberately
biased toward over-suppression.

### PLAN and JUDGE both had to be taught the tail

Otherwise they reject it as an unsupported claim and burn REVISE rounds — the exact failure
`remember_fact` hit in §27. `judgeTemplate.js` now states that the tail is a control action
verified in code against `store_products`, and that the draft's **absence** of a price is correct
rather than an omission; `planTemplate.js` states that choosing a product is a merchandising
decision needing no evidence-level backing (a health claim *about* it still does).
`detectFakeStoreProduct` (`lib/factCheck.js`) covers the remaining gap — a product named in prose
but never actually picked, which never becomes a card but reads to the user exactly like one.
`detectAllRisks`'s signature widened to `(reply, dotsFormulary, storeProducts)`; both call sites
pass it.

### Tap-through reuses everything

`handleProductCardTap` → `_openAevivaStoreGated({intent:'view_product', sku_id})` → the existing
`webview_tokens.context` bridge → GCN's `dashboard.html`, which routes it into its **existing**
`?sku=` opener (`gcn_deep_link_sku`/`maybeOpenSharedSku`), silent no-op included when the item
isn't listed in that buyer's own bound store. It `await loadMall()` rather than calling the opener
directly: the page's own `loadMall()` is fired un-awaited, so the opener would otherwise race an
empty catalog.

A native tap handler is **mandatory, not stylistic** — `_onMdLinkTap` can only offer to *copy* an
http(s) URL, because a WeChat miniapp cannot open an arbitrary external link from chat prose.

### Catalog is per-user and store-scoped

`GET /api/mall/nano/ai-catalog` (GCN, `requireNanoService`) resolves the user's bound store via
`partner_bindings` (`binding_type='consumer_store'` — **not** the superseded
`consumer_store_bindings`) and delegates listing to `handleStoreItems` rather than reimplementing
it, so VMI/MDC cascade availability stays consistent with what the storefront actually shows.
Recommending an item the user's bound store doesn't list would dead-end them on an empty grid.
**Always returns 200** — unbound, unlinked, or failing all yield `{items: []}`, following
`handleNanoFocusTemplates`' contract. `fetchAiCatalog` (`lib/gcnClient.js`) never throws either and
self-limits to 4s.

Every SKU with its own dedicated purchase flow is excluded (`is_custom_formulation`,
`is_ag_formulation_bundle`, `viva_subscription_plan_key`, `grants_partner_type`, `package_only`,
`is_parent`) — surfacing one as "here's something for your sleep" would route a shopper into a
flow they have no business entering from a chat reply.

### Files

**nano** — new: `src/schemas/migration_knowledge_store_products.sql`,
`worker/prompts/chat/productRecommendBlock.js`, `tests/store-product-recommendation.test.js`.
Modified: `worker/lib/{gcnClient,knowledgeBase,factCheck,agenticChat}.js`,
`worker/prompts/chat/{intentClassifier,factConstraint,planTemplate}.js`,
`worker/prompts/viva/judgeTemplate.js`, `worker/prompts/{nano,viva}/chat/nutrition.js`,
`worker/handlers/{chat,dots}.js`, `nano-miniapp/utils/markdown.js`,
`nano-miniapp/pages/main/main.{js,wxml,wxss}`, `utils/config.js` (VERSION).

**GCN** — new: `migration_0079_product_ai_profiles.sql`; `handleProductAiProfileGet`/`Update` +
`handleNanoAiCatalog` in `mall/index.js`. Modified:
`site/aeviva/ext-catalog-editor.js` (the AI 推荐资料 section), `site/aeviva/dashboard.html`.

