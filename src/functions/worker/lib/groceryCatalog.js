'use strict';

// Grocery catalogs (food_suppliers / supplier_products — CLAUDE.md §46): the reads shared by the
// get_grocery_products tool (lib/agenticTools.js) and the recommend_grocery tail
// (handlers/chat.js finalizeChatReply), so the model is shown and the card renders the SAME rows.
//
// THE MODEL PICKS, THE SERVER WRITES — the §37 rule, applied to a catalog we do not sell from.
// The tool hands the model names and ids but never a price; the tail hands back ids; the card is
// rendered from a fresh DB read of those ids. A hallucinated id resolves to nothing and is
// dropped, never repaired.
//
// Allergies and dietary restrictions are a CODE filter on both paths (searchGroceryProducts and
// resolveGroceryProducts), never a prompt rule — the same choice §37 made for store products.

const MAX_KEYWORDS = 8;
const PER_KEYWORD = 4;
const MAX_RESULTS = 20;
const MAX_RECOMMENDED = 6;

// A user_memory_facts row reads 「避免牛奶」/「对海鲜过敏」/「不吃猪肉」. The food word is what has to
// match a product name; the verb around it never will. Stripped, not parsed: a fact that yields
// nothing after stripping blocks nothing, which is the safe direction for a heuristic.
const FACT_PREFIX_RE = /^(避免|不吃|不能吃|不要吃|不喝|不能喝|少吃|忌|忌口|禁食|禁|对|回避|戒)/;
const FACT_SUFFIX_RE = /(过敏|不耐受|敏感|类)$/;
function _factTerm(fact) {
    return String(fact || '').trim().replace(FACT_PREFIX_RE, '').replace(FACT_SUFFIX_RE, '').trim();
}

// 素食 is the one restriction that is a category, not a word. Product names rarely say 肉.
const VEGETARIAN_RE = /(素食|纯素|吃素|vegetarian|vegan)/i;
const ANIMAL_CATEGORY_RE = /(肉禽蛋品|海鲜水产)/;
// Whole words, not single characters: 牛 alone would take 牛奶 and 牛油果 from a vegetarian.
const ANIMAL_NAME_RE = /(猪肉|牛肉|羊肉|鸡肉|鸭肉|鹅肉|鸡翅|鸡腿|鸡胸|牛排|排骨|里脊|五花|培根|火腿|香肠|腊肉|肉丸|肉片|肉馅|肉末|肉松|鱼|虾|蟹|贝|蛤|蚝|鱿|章鱼|海参|鲍鱼|海鲜)/;

function filterGroceryByUserFacts(products, userFacts) {
    const facts = (userFacts || []).filter(f => f && (f.category === 'allergy' || f.category === 'dietary_restriction'));
    if (facts.length === 0) return products || [];
    const terms = facts.map(f => _factTerm(f.fact_zh)).filter(t => t.length >= 2);
    const vegetarian = facts.some(f => VEGETARIAN_RE.test(String(f.fact_zh || '')));
    return (products || []).filter((p) => {
        const name = String(p.name || '');
        if (terms.some(t => name.includes(t))) return false;
        if (vegetarian && (ANIMAL_CATEGORY_RE.test(String(p.category || '')) || ANIMAL_NAME_RE.test(name))) return false;
        return true;
    });
}

// Keyword search over active food rows of every active supplier. ILIKE over a few thousand rows
// is well inside a tool call's budget; a trigram index can come when a catalog is ten times this.
async function searchGroceryProducts(pool, { keywords, supplier = null, userFacts = [] }) {
    const kws = [...new Set((Array.isArray(keywords) ? keywords : [keywords])
        .map(k => String(k || '').trim()).filter(k => k.length >= 1))].slice(0, MAX_KEYWORDS);
    if (kws.length === 0) return [];
    const out = [];
    const seen = new Set();
    for (const kw of kws) {
        const params = [`%${kw.replace(/[%_]/g, '')}%`, PER_KEYWORD * 3];
        let supplierClause = '';
        if (supplier) { params.push(supplier); supplierClause = ` AND sp.supplier_key = $${params.length}`; }
        const { rows } = await pool.query(
            `SELECT sp.supplier_key, sp.product_id, sp.name, sp.unit, sp.category, sp.tags,
                    fs.name_zh AS supplier_name
               FROM supplier_products sp
               JOIN food_suppliers fs ON fs.supplier_key = sp.supplier_key
              WHERE sp.is_active AND sp.is_food AND fs.is_active
                AND sp.name ILIKE $1${supplierClause}
              ORDER BY length(sp.name) ASC, sp.product_id
              LIMIT $2`,
            params
        );
        let kept = 0;
        for (const r of filterGroceryByUserFacts(rows, userFacts)) {
            const key = `${r.supplier_key}:${r.product_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ ...r, matched: kw });
            if (++kept >= PER_KEYWORD) break;
        }
        if (out.length >= MAX_RESULTS) break;
    }
    return out.slice(0, MAX_RESULTS);
}

// Resolves a recommend_grocery tail's entries to the rows the card will draw. Order and reason
// prose are the model's; everything else is read back from the table.
async function resolveGroceryProducts(pool, entries, userFacts = []) {
    const wanted = [];
    const seen = new Set();
    for (const e of Array.isArray(entries) ? entries : []) {
        const supplier = String(e?.supplier || '').trim();
        const productId = String(e?.product_id || '').trim();
        if (!supplier || !productId) continue;
        const key = `${supplier}:${productId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        wanted.push({ supplier, productId, reason_zh: String(e?.reason_zh || '').trim().slice(0, 60) });
        if (wanted.length >= MAX_RECOMMENDED * 2) break;
    }
    if (wanted.length === 0) return [];
    const { rows } = await pool.query(
        `SELECT sp.supplier_key, sp.product_id, sp.name, sp.price, sp.unit, sp.category, sp.image_url,
                fs.name_zh AS supplier_name, fs.app_name_zh
           FROM supplier_products sp
           JOIN food_suppliers fs ON fs.supplier_key = sp.supplier_key
          WHERE sp.is_active AND sp.is_food AND fs.is_active
            AND (sp.supplier_key, sp.product_id) IN (${wanted.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')})`,
        wanted.flatMap(w => [w.supplier, w.productId])
    );
    const byKey = new Map(filterGroceryByUserFacts(rows, userFacts).map(r => [`${r.supplier_key}:${r.product_id}`, r]));
    const out = [];
    for (const w of wanted) {
        const r = byKey.get(`${w.supplier}:${w.productId}`);
        if (!r) continue;
        out.push({ ...r, reason_zh: w.reason_zh });
        if (out.length >= MAX_RECOMMENDED) break;
    }
    return out;
}

async function fetchActiveSuppliers(pool) {
    const { rows } = await pool.query(
        `SELECT supplier_key, name_zh, name_en, app_name_zh, store_note
           FROM food_suppliers WHERE is_active ORDER BY supplier_key`);
    return rows;
}

module.exports = {
    MAX_RECOMMENDED,
    filterGroceryByUserFacts,
    searchGroceryProducts,
    resolveGroceryProducts,
    fetchActiveSuppliers,
    _factTerm,
};
