'use strict';

// The two server-written chat cards: the :::formula card for a validated dot allocation and the
// :::product card for a validated set of store recommendations. Both follow the same rule
// (CLAUDE.md §28, §37): the SERVER writes every row from data the request already validated — the
// model never authors a fence, so a card can never disagree with the numbers it draws or with what
// checkout will charge. The miniapp's utils/markdown.js is the only parser; main.wxml the renderer.
//
// Carved out of handlers/dots.js on 2026-09-16. No DB, no network: given a recipe pair and the
// formulary, it returns a string. Never run humanizeDotCodes() over a card — a row is keyed on the
// dot code (§28, "The card").

const { PLAN_DAYS } = require('./dotsProductModel');
const { _planDayGroups, _ladderKeys } = require('./formulation');

// [1,2,3,5,9,10] -> "1-3,5,9-10". Numbers only: the renderer owns the "Day N" / "第N天" wording,
// because this module has no language context and must not hardcode one.
function _formatDayRanges(days) {
    const sorted = [...days].sort((a, b) => a - b);
    const parts = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
        const d = sorted[i];
        if (d === prev + 1) { prev = d; continue; }
        parts.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
        runStart = d;
        prev = d;
    }
    return parts.join(',');
}

// A tier's pitch is one line under its dot list in a chat bubble, not a paragraph. Capped
// server-side rather than only asked for in the prompt, because a model that ignores the word
// limit would otherwise push the card's CTA off the screen.
const TIER_PITCH_MAX = 90;

// Sanitises a tier's model-authored pitch, and DROPS it outright if it names a dot that tier does
// not contain.
//
// The model writes the copy but the server decides membership — and live dev testing (2026-09-07)
// caught the two disagreeing on the first real run: a pitch reading "加配肠道焕新与脉络畅流" sat above
// a tier holding 脉络畅流 and 心血管信号, while the one below it named 抗氧化盾, a dot the formulation
// did not contain at all. The model had narrated the split it meant and then tagged a different one.
//
// The prompt asks for benefit-framed copy that names no dots (the card lists them on the very next
// line, so naming them was redundant even when it was right). This is the backstop, and it drops
// rather than repairs: an unlabelled tier is a tier, but a tier promising a dot the user will not
// receive is the one thing on this card the server would otherwise have let the model assert.
function _tierPitch(tier, dotsFormulary) {
    const pitch = String(tier.pitch || '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim().slice(0, TIER_PITCH_MAX);
    if (!pitch) return '';
    const mine = _ladderKeys(tier.morning, tier.evening);
    for (const dot of dotsFormulary || []) {
        if (mine.has(dot.key_name)) continue;
        // Both display names and the conversational key ("原粒13号"), which is how the prompt tells
        // the model to refer to a dot in prose.
        for (const alias of [dot.name_zh, dot.name, dot.key_name_zh]) {
            if (alias && String(alias).length >= 2 && pitch.includes(alias)) return '';
        }
    }
    return pitch;
}

// Renders the :::formula card for a validated allocation.
//
// The SERVER writes every row, from the recipe it just validated — the model never authors this
// block, so the bars can never disagree with the numbers they draw. Every total is derived in the
// renderer, so the arithmetic lives in exactly one place.
//
// Row format (unchanged, and still the only thing a legacy card in chat history contains):
//   key|name|color|am|pm
//
// Meta lines were added when the card became a 28-day proposal rather than a single steady-state
// day. They are all prefixed '#', which no dot key can start with, so a card saved before this
// change simply has none of them and renders as one unlabelled group exactly as it used to:
//   #cycle|<days>|<capsules>   the cycle length, for the footer
//   #plan|<id>                 the nutrition_plans row this proposes, enabling the store CTA
//   #order|<mode>              which call to action this card gets (see below)
//   #label|<url>               the formulation's QR/label page — the same GCN aeviva link that
//                              gets printed on the box and scanned to activate it
//   #day|<ranges>|<kind>       starts a group; every row after it belongs to that group
//   #tier|<label>|<width>|<rec> starts a PACKAGE: every #day group and row after it belongs to it,
//                              until the next #tier. Only ever present in 'buy' mode (see below) —
//                              a user who already paid holds a fixed tier and is not choosing.
//                              <rec> is 1 on exactly one tier: the narrowest that carries the whole
//                              formulation (see _buildTierLadder). Cards written before three
//                              packages existed have no #tier at all and render as one.
//   #note|<text>               that package's own positioning line, verbatim from the store
//   #pitch|<text>              that package's line for THIS user, from lib/tierCopy.js
//
// #rung|<label>|<width>|<pitch> is retired and no longer written: three complete formulas replaced
// the base-plus-two-upgrade-rungs layout on 2026-09-10, once GCN's migration_0107/0108 renamed the
// tiers off their dot counts and gave each one its own positioning. The renderer still PARSES it —
// chat history is permanent and every card written before that date contains one.
//
// A custom-dots order can be placed in either sequence, and the card is where the difference
// shows. `#order` is the mode:
//   buy      no paid package waiting — offer to order this formulation. The default, and what a
//            failed/absent order lookup degrades to: a buy button someone has already paid past
//            is ignorable, whereas a submit button with no order behind it fails on tap.
//   submit   a paid fast-track package is waiting — offer to confirm THIS formula for compounding.
//   ag       a paid premium package is waiting, and Viva AG formulates that one after expert
//            review. No CTA at all: this card is a preview, and tapping anything here would
//            compete with the pipeline that actually owns the order.
function _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang, opts) {
    const isZh = (lang || 'zh') !== 'en';
    const lines = [`#cycle|${PLAN_DAYS}|${PLAN_DAYS * 2}`];
    if (opts && opts.planId) lines.push(`#plan|${opts.planId}`);
    if (opts && opts.orderMode) lines.push(`#order|${opts.orderMode}`);
    // NO `#label`. The card used to carry the formulation's label/QR page, but a proposal is not a
    // purchase: nothing has been paid for and no box exists, so a QR here points at a label for
    // capsules nobody is compounding. The label belongs after payment, on the GCN order that will
    // actually be fulfilled. `label_code` is still minted with the plan (see _commitProposedPlan)
    // and the public label page is unchanged — this only stops advertising it in chat.

    // Pipes would break the row split, and a dot name is admin-editable free text.
    const clean = (text) => String(text == null ? '' : text).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();

    // One tier's day groups, as `#day` plus `key|name|color|am|pm` rows. Returns [] when the recipe
    // has nothing to draw, so a tier that expands to no capsule at all is skipped whole rather than
    // rendered as a heading over a blank chart.
    const groupLines = (tierMorning, tierEvening) => {
        const out = [];
        for (const group of _planDayGroups(tierMorning, tierEvening, dotsFormulary)) {
            const rows = [];
            for (const dot of dotsFormulary || []) {
                const am = group.morning.dots[dot.key_name] || 0;
                const pm = group.evening.dots[dot.key_name] || 0;
                if (am === 0 && pm === 0) continue;
                const name = (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
                rows.push(`${dot.key_name}|${clean(name)}|${dot.color_hex || ''}|${am}|${pm}`);
            }
            if (!rows.length) continue;
            out.push(`#day|${_formatDayRanges(group.days)}|${group.kind}`);
            out.push(...rows);
        }
        return out;
    };

    const tiers = (opts && Array.isArray(opts.tiers) && opts.tiers.length) ? opts.tiers : null;
    if (!tiers) {
        // No ladder: a user who already holds a package is not choosing between them, and neither
        // is a card written before three packages existed. One unlabelled formula, exactly as this
        // renderer has always produced.
        const only = groupLines(morningRecipe, eveningRecipe);
        if (!only.length) return '';
        lines.push(...only);
        return `\n\n:::formula\n${lines.join('\n')}\n:::`;
    }

    // Three COMPLETE formulas, one per purchasable package — not one chart with upgrades bolted
    // underneath. Each is expanded through the same _planDayGroups the single-formula card uses, so
    // a tier's chart is drawn by exactly the code that draws the one the user ends up taking, and
    // the numbers cannot drift apart.
    let anyTier = false;
    for (const tier of tiers) {
        const rows = groupLines(tier.morning, tier.evening);
        if (!rows.length) continue;
        anyTier = true;
        lines.push(`#tier|${clean(tier.tier_label)}|${tier.max_distinct_dots}|${tier.recommended ? 1 : 0}`);
        // The store's own line for this package, and then the one written for this user. Both
        // optional: the tagline is absent until GCN's catalog carries one, and the pitch is
        // dropped outright rather than repaired when it names a dot this tier does not hold.
        const note = clean(tier.tier_description);
        if (note) lines.push(`#note|${note}`);
        const pitch = _tierPitch(tier, dotsFormulary);
        if (pitch) lines.push(`#pitch|${pitch}`);
        lines.push(...rows);
    }
    if (!anyTier) return '';
    return `\n\n:::formula\n${lines.join('\n')}\n:::`;
}

// Renders the :::product card for a validated set of store recommendations.
//
// Same contract as _buildFormulaChartBlock directly above, and for the same reason: the SERVER
// writes every name and price, from the catalog snapshot the request already fetched — the model
// only ever supplied a sku_id and a sentence of reasoning. A price the model was never shown is a
// price it cannot get wrong, and the card can never disagree with what checkout will charge.
//
// `items` are already validated against the snapshot and capped by the caller
// (finalizeChatReply). Rows are sku|name|price|reason; the renderer
// (miniapp utils/markdown.js) derives display from these and nothing else.
function _buildProductCardBlock(items, lang) {
    const isZh = (lang || 'zh') !== 'en';
    const rows = [];
    for (const it of items || []) {
        if (!it || !it.sku_id) continue;
        // Pipes would break the row split; product names and reasons are both free text (one
        // admin-authored, one model-authored), so neither may be trusted to be pipe-free.
        const safe = v => String(v == null ? '' : v).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();
        const price = it.price_cny != null && Number.isFinite(Number(it.price_cny))
            ? `¥${Number(it.price_cny).toFixed(2).replace(/\.00$/, '')}`
            : (isZh ? '价格以商城为准' : 'see store');
        rows.push(`${safe(it.sku_id)}|${safe(it.product_name_zh)}|${price}|${safe(it.reason_zh)}`);
    }
    if (!rows.length) return '';
    return `\n\n:::product\n${rows.join('\n')}\n:::`;
}


// Renders the :::grocery card for a resolved set of supermarket products (CLAUDE.md §46).
//
// Same contract as _buildProductCardBlock: the SERVER writes every name, price and image URL,
// from the rows resolveGroceryProducts read back for the ids the model returned. The model only
// ever supplied ids and one sentence of reasoning. Rows are
//   supplier|supplier_name|product_id|name|price|image_url|reason
// plus one `#note` meta line naming the app(s) to order in, so the renderer never has to know a
// supplier. The price is a scrape-time snapshot, and the card says so — it is never a quote.
function _buildGroceryCardBlock(items, lang) {
    const isZh = (lang || 'zh') !== 'en';
    const safe = v => String(v == null ? '' : v).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();
    const rows = [];
    const apps = [];
    for (const it of items || []) {
        if (!it || !it.supplier_key || !it.product_id) continue;
        const price = it.price != null && Number.isFinite(Number(it.price))
            ? `¥${Number(it.price).toFixed(2).replace(/\.?0+$/, '')}${it.unit ? '/' + safe(it.unit) : ''}`
            : '';
        rows.push([it.supplier_key, it.supplier_name, it.product_id, it.name, price, it.image_url, it.reason_zh].map(safe).join('|'));
        if (it.app_name_zh && !apps.includes(it.app_name_zh)) apps.push(it.app_name_zh);
    }
    if (!rows.length) return '';
    const note = isZh
        ? `#note|价格为抓取时参考价，以 ${apps.join(' / ') || '超市 App'} 实际为准；点击复制商品名后到 App 搜索下单`
        : `#note|Prices are a snapshot; the ${apps.join(' / ') || 'supermarket'} app has the current one. Tap a row to copy the name, then search for it there`;
    return `\n\n:::grocery\n${note}\n${rows.join('\n')}\n:::`;
}


module.exports = {
    _formatDayRanges,
    _tierPitch,
    _buildFormulaChartBlock,
    _buildProductCardBlock,
    _buildGroceryCardBlock,
};
