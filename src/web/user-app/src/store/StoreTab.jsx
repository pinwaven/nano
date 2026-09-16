// The 补给 tab — the native store (pages/main/main.wxml STORE block, main.js:_loadStore /
// _syncCart / handleCheckout / handleCancelOrder, mapStoreItems / mapStoreOrders). On a
// GCN-linked channel the tab button opens the GCN storefront instead and this never shows
// (App.switchTab). Cart persists in localStorage.nano_cart; checkout is POST /orders/batch.
import { useCallback, useEffect, useState } from 'react';
import { api, q, clipboard } from '../api.js';
import { STORAGE_KEYS as K } from '../config.js';
import { useApp, storage } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';
import { asset } from '../assets.js';

function prepDescHtml(html) {
  return html.replace(/<img\b([^>]*?)\/?>/gi, (m, attrs) => (/style\s*=/i.test(attrs)
    ? `<img${attrs.replace(/style\s*=\s*"([^"]*)"/i, 'style="max-width:100%;height:auto;$1"')}>`
    : `<img style="max-width:100%;height:auto;display:block;"${attrs ? ' ' + attrs : ''}>`));
}
export function mapStoreItems(rawItems, lang, t) {
  const tagLabel = tag => (tag === 'bestseller' ? t.storeBestseller : tag === 'value' ? t.storeValue : null);
  return rawItems.map(item => {
    const partnerRaw = lang === 'zh' ? item.partner_price_cny : item.partner_price_usd;
    const hasPartnerPrice = partnerRaw != null;
    const desc = (lang === 'zh' ? item.desc_zh : item.desc_en) || '';
    const descIsHtml = /<[a-z][^>]*>/i.test(desc);
    const hasCreditsPrice = item.price_credits != null;
    const creditsRaw = hasCreditsPrice ? parseFloat(item.price_credits) : null;
    return {
      id: item.id, key: item.key_name, name: lang === 'zh' ? item.name_zh : item.name_en, desc: descIsHtml ? prepDescHtml(desc) : desc, descIsHtml,
      unit: lang === 'zh' ? item.unit_zh : item.unit_en,
      price: hasCreditsPrice ? `${creditsRaw} ${lang === 'zh' ? '积分' : 'pts'}` : (lang === 'zh' ? `¥${item.price_cny}` : `$${item.price_usd}`),
      partnerPrice: (!hasCreditsPrice && hasPartnerPrice) ? (lang === 'zh' ? `¥${partnerRaw}` : `$${partnerRaw}`) : '',
      rawPrice: hasCreditsPrice ? creditsRaw : (hasPartnerPrice ? partnerRaw : (lang === 'zh' ? (item.price_cny || 0) : (item.price_usd || 0))),
      useCredits: hasCreditsPrice, tagLabel: tagLabel(item.tag),
      variants: item.variants ? item.variants.map(v => ({ id: v.id, skuCode: v.sku_code, label: Object.entries(v.attributes || {}).map(([k, val]) => `${k} ${val}`).join(' · '), stockQuantity: v.stock_quantity })) : null,
      selectedVariantId: null,
    };
  });
}
export function mapStoreOrders(rawOrders, lang) {
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';
  return rawOrders.map(o => ({
    id: o.id, shortId: o.id.slice(0, 8), name: lang === 'zh' ? (o.name_zh || o.item_key) : (o.name_en || o.item_key), unit: lang === 'zh' ? o.unit_zh : o.unit_en, quantity: o.quantity,
    price: o.price_credits != null ? `${o.price_credits} ${lang === 'zh' ? '积分' : 'pts'}` : (lang === 'zh' ? `¥${o.price_cny}` : `$${o.price_usd}`),
    status: o.status, createdAt: new Date(o.created_at).toLocaleDateString(loc),
    shippingName: o.shipping_name || '', shippingPhone: o.shipping_phone || '', shippingAddress: o.shipping_address || '', shippingCarrier: o.shipping_carrier || '', trackingNumber: o.tracking_number || '',
  }));
}

export default function StoreTab({ onGuestTap }) {
  const app = useApp();
  const { user, lang, t, isGuest, isAeviva, creditBalance, loadCreditBalance, on } = app;
  const userId = user?.user_id;
  const [loading, setLoading] = useState(true);
  const [rawItems, setRawItems] = useState([]);
  const [rawOrders, setRawOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [subTab, setSubTab] = useState('products');
  const [cart, setCart] = useState(() => { const c = storage.get(K.cart); return Array.isArray(c) ? c : []; });
  const [cartOpen, setCartOpen] = useState(false);
  const [ship, setShip] = useState({ name: '', phone: '', address: '' });

  const orders = mapStoreOrders(rawOrders, lang);
  useEffect(() => { setItems(prev => { const sel = new Map(prev.map(i => [i.id, i.selectedVariantId])); return mapStoreItems(rawItems, lang, t).map(i => ({ ...i, selectedVariantId: sel.get(i.id) || null })); }); }, [rawItems, lang, t]);

  const loadOrders = useCallback(async () => { if (!userId || isGuest) return; try { const res = await api.get(`/my-orders?openid=${q(userId)}`); setRawOrders(res?.orders || []); } catch { /* ignore */ } }, [userId, isGuest]);
  const load = useCallback(async () => {
    try { const res = await api.get(`/store-items${userId && !isGuest ? `?openid=${q(userId)}` : ''}`); setRawItems(res?.items || []); } catch { /* ignore */ }
    setLoading(false);
    await loadOrders();
  }, [userId, isGuest, loadOrders]);
  // The GCN-linked channels never render this tab (their Store button opens the storefront).
  useEffect(() => { if (!isAeviva || isGuest) load(); }, [load, isAeviva, isGuest]);
  useEffect(() => on('tab:switch', tab => { if (tab === 'store' && (!isAeviva || isGuest)) load(); }), [on, load, isAeviva, isGuest]);

  const cartMap = {}; let cartTotalRaw = 0, cartCount = 0;
  for (const e of cart) { cartMap[e.id] = e.quantity; cartTotalRaw += e.rawPrice * e.quantity; cartCount += e.quantity; }
  const allCredits = cart.length > 0 && cart.every(e => e.useCredits);
  const cartTotal = allCredits ? `${cartTotalRaw} ${lang === 'zh' ? '积分' : 'pts'}` : (lang === 'zh' ? `¥${cartTotalRaw}` : `$${(cartTotalRaw / 7.2).toFixed(0)}`);
  const syncCart = next => { setCart(next); storage.set(K.cart, next); };
  const addToCart = item => {
    if (isGuest) { onGuestTap?.(); return; }
    if (item.variants && item.variants.length > 0) {
      if (!item.selectedVariantId) { ui.toast(lang === 'zh' ? '请先选择规格' : 'Please select a size'); return; }
      const variant = item.variants.find(v => v.id === item.selectedVariantId);
      const ci = { ...item, id: item.selectedVariantId, name: item.name + ' ' + variant.label, variants: null };
      const next = [...cart]; const ex = next.find(x => x.id === ci.id);
      if (ex) ex.quantity += 1; else next.push({ ...ci, quantity: 1 });
      syncCart(next); return;
    }
    const next = [...cart]; const ex = next.find(x => x.id === item.id);
    if (ex) ex.quantity += 1; else next.push({ ...item, quantity: 1 });
    syncCart(next);
  };
  const qty = (id, delta) => { const next = [...cart]; const i = next.findIndex(x => x.id === id); if (i === -1) return; next[i] = { ...next[i], quantity: next[i].quantity + delta }; if (next[i].quantity <= 0) next.splice(i, 1); syncCart(next); };
  const closeCart = () => { setCartOpen(false); setShip({ name: '', phone: '', address: '' }); };

  const checkout = async () => {
    if (isGuest) { onGuestTap?.(); return; }
    if (cart.length === 0) return;
    const useCredits = cart.every(x => x.useCredits);
    const needCredits = useCredits ? cart.reduce((s, x) => s + x.rawPrice * x.quantity, 0) : 0;
    const showInsufficient = () => ui.confirm({ title: t.checkoutInsufficientTitle, content: t.checkoutInsufficientMsg.replace('{need}', needCredits).replace('{have}', creditBalance), showCancel: false, confirmText: 'OK' });
    if (useCredits && creditBalance < needCredits) { showInsufficient(); return; }
    const name = ship.name.trim(), phone = ship.phone.trim(), address = ship.address.trim();
    if (!(name && phone && address)) { setCartOpen(true); setShip(s => ({ ...s, name: s.name || user.nickname || '', phone: s.phone || user.phone || '' })); return; }
    ui.loading(t.storeOrderSent || 'Processing...', true);
    try {
      const res = await api.post('/orders/batch', { openid: userId, items: cart.map(x => ({ channel_inventory_item_id: x.id, quantity: x.quantity })), shipping_name: name, shipping_phone: phone, shipping_address: address, payment_method: useCredits ? 'credits' : 'wechat_pay', payment_status: 'paid' }, { raw: true });
      ui.loading('', false);
      if (!res.data?.success) {
        if (/insufficient credits/i.test(res.data?.error || '')) { await loadCreditBalance(); showInsufficient(); } else ui.toast(t.errServer, { duration: 2500 });
        return;
      }
      ui.toast(t.storeOrderSent || 'Order Sent', { duration: 2500 });
      syncCart([]); closeCart(); await loadOrders(); setSubTab('orders'); loadCreditBalance();
    } catch { ui.loading('', false); ui.toast(t.errServer, { duration: 2500 }); }
  };
  const cancelOrder = async id => {
    const { confirm } = await ui.confirm({ title: lang === 'zh' ? '取消订单' : 'Cancel Order', content: lang === 'zh' ? '您确定要取消此订单吗？' : 'Are you sure you want to cancel this order?' });
    if (!confirm) return;
    try { await api.put(`/orders/${id}`, { status: 'cancelled' }); ui.toast(lang === 'zh' ? '订单已取消' : 'Order cancelled'); await loadOrders(); } catch { ui.toast(t.errServer); }
  };

  return (
    <div className="store-tab">
      <div className="store-header">
        <span className="store-title">{t.storeTitle}</span>
        <div className="store-header-right">
          {!isGuest && (
            <div className="store-credit-card"><div className="store-credit-card-glow" /><img className="store-credit-card-icon" src={asset('/assets/icons/credits.svg')} alt="" />
              <div className="store-credit-card-body"><div className="store-credit-card-amount-row"><span className="store-credit-card-num">{creditBalance}</span><span className="store-credit-card-unit">pts</span></div><span className="store-credit-card-label">{lang === 'zh' ? '我的积分' : 'MY CREDITS'}</span></div>
            </div>
          )}
          {cartCount > 0 && <div className="store-cart-icon" onClick={() => setCartOpen(true)}><span className="store-cart-badge">{cartCount}</span></div>}
        </div>
      </div>
      {!loading && (
        <div className="store-subtab-row">
          <div className={`store-subtab-btn${subTab === 'products' ? ' store-subtab-active' : ''}`} onClick={() => setSubTab('products')}><span>{t.storeSubProducts}</span></div>
          <div className={`store-subtab-btn${subTab === 'orders' ? ' store-subtab-active' : ''}`} onClick={() => setSubTab('orders')}><span>{t.storeSubOrders}</span></div>
        </div>
      )}
      {loading ? <div className="center-wrap"><div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" /></div>
        : subTab === 'products' ? (items.length > 0 ? (
          <div className="store-scroll tab-scroll"><div className="store-list">
            {items.map(item => (
              <div key={item.id} className="store-card">
                {item.tagLabel && <div className="store-tag"><span className="store-tag-text">{item.tagLabel}</span></div>}
                <span className="store-card-name">{item.name}</span>
                {item.descIsHtml ? <div className="store-card-desc store-card-desc-rich" dangerouslySetInnerHTML={{ __html: item.desc }} /> : <span className="store-card-desc">{item.desc}</span>}
                {item.variants?.length > 0 && <div className="store-variants">{item.variants.map(v => <div key={v.id} className={`store-variant-pill${item.selectedVariantId === v.id ? ' store-variant-pill-active' : ''}`} onClick={() => setItems(list => list.map(it => (it.id === item.id ? { ...it, selectedVariantId: v.id } : it)))}><span className="store-variant-label">{v.label}</span></div>)}</div>}
                <div className="store-card-footer">
                  {item.partnerPrice ? (
                    <div className="store-price-wrap store-price-wrap-partner"><div className="store-partner-row"><div className="store-partner-badge"><span className="store-partner-badge-text">{t.storePartnerPrice}</span></div><span className="store-price store-price-partner">{item.partnerPrice}</span><span className="store-unit">/ {item.unit}</span></div><span className="store-price-regular">{item.price}</span></div>
                  ) : <div className="store-price-wrap"><span className="store-price">{item.price}</span><span className="store-unit">/ {item.unit}</span></div>}
                  {!cartMap[item.selectedVariantId || item.id] ? <div className="store-buy-btn" onClick={() => addToCart(item)}><span className="store-buy-label">{t.storeAddToCart}</span></div>
                    : <div className="cart-stepper"><div className="stepper-btn" onClick={() => qty(item.selectedVariantId || item.id, -1)}><span className="stepper-sym">－</span></div><span className="stepper-qty">{cartMap[item.selectedVariantId || item.id]}</span><div className="stepper-btn" onClick={() => qty(item.selectedVariantId || item.id, 1)}><span className="stepper-sym">＋</span></div></div>}
                </div>
              </div>
            ))}
            <div style={{ height: cartCount > 0 ? 70 : 16 }} />
          </div></div>
        ) : <div className="dots-empty"><span>{t.storeEmpty}</span></div>)
        : orders.length > 0 ? (
          <div className="store-scroll tab-scroll"><div className="store-list">
            {orders.map(o => (
              <div key={o.id} className="order-card">
                <div className="order-card-top"><span className="order-name">{o.name}</span><div className={`order-status order-status-${o.status}`}><span>{t.orderStatus?.[o.status] || o.status}</span></div></div>
                <div className="order-card-mid"><span className="order-price">{o.price}</span><span className="order-meta"> · {o.unit} · ×{o.quantity}</span></div>
                <div className="order-date-row"><span className="order-date">{o.createdAt}</span></div>
                {o.shippingName && (
                  <div className="order-delivery-info">
                    <div className="delivery-row"><span className="delivery-label">{lang === 'zh' ? '收货人' : 'Recipient'}</span><span className="delivery-val">{o.shippingName} ({o.shippingPhone})</span></div>
                    <div className="delivery-row"><span className="delivery-label">{lang === 'zh' ? '收货地址' : 'Address'}</span><span className="delivery-val">{o.shippingAddress}</span></div>
                    {o.trackingNumber && <div className="delivery-row tracking-section"><span className="delivery-label">{lang === 'zh' ? '快递单号' : 'Tracking'}</span><div className="tracking-val-wrap"><span className="delivery-val bold">{o.shippingCarrier} {o.trackingNumber}</span><div className="copy-badge" onClick={async () => { if (await clipboard.write(o.trackingNumber)) ui.toast(lang === 'zh' ? '单号已复制' : 'Tracking copied'); }}><span>{lang === 'zh' ? '复制' : 'Copy'}</span></div></div></div>}
                  </div>
                )}
                {o.status === 'pending' && <div className="order-actions"><div className="cancel-order-btn" onClick={() => cancelOrder(o.id)}><span>{lang === 'zh' ? '取消订单' : 'Cancel Order'}</span></div></div>}
              </div>
            ))}
            <div style={{ height: 16 }} />
          </div></div>
        ) : <div className="dots-empty"><span>{t.noOrders}</span></div>}

      {cartCount > 0 && subTab === 'products' && !loading && (
        <div className="cart-bar" onClick={() => setCartOpen(true)}>
          <span className="cart-bar-label">{t.storeCartTotal} · {cartCount}{t.storeCartItems}</span>
          <div className="cart-bar-right"><span className="cart-bar-total">{cartTotal}</span><div className="cart-bar-btn" onClick={e => { e.stopPropagation(); checkout(); }}><span className="cart-bar-btn-text">{t.storeCartCheckout}</span></div></div>
        </div>
      )}
      {cartOpen && (
        <div className="cart-overlay" onClick={closeCart}>
          <div className="cart-sheet" onClick={e => e.stopPropagation()}>
            <div className="cart-sheet-header"><span className="cart-sheet-title">{t.storeCart}</span><div className="cart-close-btn" onClick={closeCart}><span className="cart-close-sym">✕</span></div></div>
            <div className="cart-sheet-scroll tab-scroll">
              {cart.length === 0 && <div className="cart-empty-row"><span className="cart-empty-text">{t.storeCartEmpty}</span></div>}
              {cart.map(item => (
                <div key={item.id} className="cart-item-row">
                  <div className="cart-item-info"><span className="cart-item-name">{item.name}</span><span className="cart-item-price">{item.partnerPrice || item.price} / {item.unit}</span></div>
                  <div className="cart-stepper cart-stepper-sm"><div className="stepper-btn" onClick={() => qty(item.id, -1)}><span className="stepper-sym">－</span></div><span className="stepper-qty">{item.quantity}</span><div className="stepper-btn" onClick={() => qty(item.id, 1)}><span className="stepper-sym">＋</span></div></div>
                </div>
              ))}
              {cart.length > 0 && (
                <div className="checkout-addr-form">
                  <div className="checkout-addr-hdr"><span className="checkout-addr-title">{t.checkoutShippingTitle}</span></div>
                  <div className="checkout-addr-row"><span className="checkout-addr-label">{t.checkoutName}</span><input className="checkout-addr-input" placeholder={t.checkoutNamePh} value={ship.name} onChange={e => setShip(s => ({ ...s, name: e.target.value }))} /></div>
                  <div className="checkout-addr-row"><span className="checkout-addr-label">{t.checkoutPhone}</span><input className="checkout-addr-input" placeholder={t.checkoutPhonePh} value={ship.phone} inputMode="tel" onChange={e => setShip(s => ({ ...s, phone: e.target.value }))} /></div>
                  <div className="checkout-addr-row checkout-addr-row-tall"><span className="checkout-addr-label">{t.checkoutAddress}</span><textarea className="checkout-addr-textarea" placeholder={t.checkoutAddressPh} value={ship.address} rows={2} onChange={e => setShip(s => ({ ...s, address: e.target.value }))} /></div>
                </div>
              )}
            </div>
            <div className="cart-sheet-footer"><span className="cart-total-text">{t.storeCartTotal}  {cartTotal}</span>{cart.length > 0 && <div className="cart-checkout-btn" onClick={checkout}><span className="cart-checkout-text">{t.storeCartCheckout}</span></div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
