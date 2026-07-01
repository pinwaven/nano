import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import { fmtDate } from '../utils.js';

const API = '/api';

// ── Credits Section ───────────────────────────────────────────────────────────

function CreditsView({ user, lang }) {
  const { t } = useLang();
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.user_id) return;
    Promise.all([
      axios.get(`${API}/credits/balance?openid=${encodeURIComponent(user.user_id)}`),
      axios.get(`${API}/credits/history?openid=${encodeURIComponent(user.user_id)}`),
    ]).then(([bRes, hRes]) => {
      setBalance(bRes.data.balance ?? bRes.data.credits_balance ?? 0);
      setHistory(hRes.data.history || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user?.user_id]);

  return (
    <div className="credits-view">
      <div className="credits-hero">
        <div className="credits-balance-label">{t.stBalance}</div>
        <div className="credits-balance-val">
          {balance == null ? '—' : t.stCreditsUnit(balance)}
        </div>
      </div>
      <div className="credits-history-title">{t.stCreditHistory}</div>
      {loading ? (
        <div className="ac-loading"><span /><span /><span /></div>
      ) : history.length === 0 ? (
        <div className="ac-empty">{t.stNoCreditHistory}</div>
      ) : (
        <div className="credits-history-list">
          {history.map((row, i) => (
            <div key={i} className="credits-row">
              <div className="credits-row-left">
                <span className="credits-row-desc">{row.description || row.type}</span>
                <span className="credits-row-date">{fmtDate(row.created_at, lang)}</span>
              </div>
              <span className={`credits-row-amount${row.amount > 0 ? ' pos' : ' neg'}`}>
                {row.amount > 0 ? '+' : ''}{row.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cart ──────────────────────────────────────────────────────────────────────

function CartModal({ cart, items, user, lang, onClose, onSuccess }) {
  const { t } = useLang();
  const [payMethod, setPayMethod] = useState('cny');
  const [name, setName] = useState(user.nickname || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [address, setAddress] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const itemsMap = {};
  items.forEach(i => { itemsMap[i.id] = i; });

  const lineItems = Object.entries(cart).map(([id, qty]) => ({ item: itemsMap[id], qty })).filter(x => x.item);
  const totalCny = lineItems.reduce((s, x) => s + (Number(x.item.price_cny || 0) * x.qty), 0);
  const totalPts = lineItems.reduce((s, x) => s + (Number(x.item.price_credits || 0) * x.qty), 0);

  const placeOrder = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setError(t.lang === 'zh' ? '请填写收货信息' : 'Please fill in all address fields.');
      return;
    }
    setPlacing(true);
    setError('');
    try {
      await axios.post(`${API}/orders`, {
        openid: user.user_id,
        items: lineItems.map(x => ({ store_item_id: x.item.id, quantity: x.qty })),
        shipping_name: name.trim(),
        shipping_phone: phone.trim(),
        shipping_address: address.trim(),
        payment_method: payMethod,
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || t.errServer);
    }
    setPlacing(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{t.stCart}</div>

        <div className="cart-line-items">
          {lineItems.map(({ item, qty }) => (
            <div key={item.id} className="cart-line">
              <span className="cart-line-name">{item.name_zh || item.name_en || item.key_name}</span>
              <span className="cart-line-qty">× {qty}</span>
              <span className="cart-line-price">{t.stCnyPrice(Number(item.price_cny || 0) * qty)}</span>
            </div>
          ))}
          <div className="cart-total">
            <span>{t.stTotal}</span>
            <span>{payMethod === 'credits' ? t.stCreditPrice(totalPts) : t.stCnyPrice(totalCny.toFixed(2))}</span>
          </div>
        </div>

        <div className="modal-form">
          <div className="modal-form-group">
            <label className="modal-form-label">{t.stAddress}</label>
            <input className="modal-input" placeholder={t.stName} value={name} onChange={e => setName(e.target.value)} />
            <input className="modal-input" placeholder={t.stPhone2} value={phone} onChange={e => setPhone(e.target.value)} style={{ marginTop: 6 }} />
            <textarea className="modal-textarea" placeholder={t.stAddrDetail} value={address} onChange={e => setAddress(e.target.value)} rows={2} style={{ marginTop: 6 }} />
          </div>
          <div className="modal-form-group">
            <label className="modal-form-label">{t.stPayMethod}</label>
            <div className="pay-method-row">
              {['cny', 'credits'].map(pm => (
                <button key={pm} className={`pay-method-btn${payMethod === pm ? ' active' : ''}`} onClick={() => setPayMethod(pm)}>
                  {pm === 'cny' ? t.stPayCny : t.stPayCredits}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="modal-msg modal-msg--err">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn modal-btn--ghost" onClick={onClose}>{t.cancel}</button>
          <button className="modal-btn modal-btn--primary" onClick={placeOrder} disabled={placing}>
            {placing ? '…' : t.stCheckout}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Order History ─────────────────────────────────────────────────────────────

function OrdersView({ user, lang }) {
  const { t } = useLang();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.user_id) return;
    axios.get(`${API}/my-orders?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setOrders(r.data.orders || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [user?.user_id]);

  if (loading) return <div className="ac-loading"><span /><span /><span /></div>;
  if (!orders.length) return <div className="ac-empty">{t.stNoOrders}</div>;

  return (
    <div className="order-list">
      {orders.map(order => (
        <div key={order.id} className="order-card">
          <div className="order-card-top">
            <span className="order-id">#{String(order.id).padStart(6, '0')}</span>
            <span className={`order-status-badge order-status--${order.status}`}>
              {t.stOrderStatus[order.status] || order.status}
            </span>
          </div>
          <div className="order-card-date">{fmtDate(order.created_at, lang)}</div>
          {order.items && (
            <div className="order-items-preview">
              {(Array.isArray(order.items) ? order.items : []).slice(0, 3).map((it, i) => (
                <span key={i} className="order-item-chip">{it.name_zh || it.key_name || it.name} ×{it.quantity}</span>
              ))}
            </div>
          )}
          {order.total_cny && (
            <div className="order-total">{order.payment_method === 'credits' ? '' : `¥${order.total_cny}`}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function StoreTab({ user }) {
  const { t, lang } = useLang();
  const [subTab, setSubTab] = useState('products');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({});
  const [showCart, setShowCart] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  useEffect(() => {
    axios.get(`${API}/store-items?show_in_store=true`)
      .then(r => setItems((r.data.items || []).filter(i => i.show_in_store !== false && i.active !== false)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const addToCart = (item) => {
    if (!item.stock_quantity || item.stock_quantity <= 0) return;
    setCart(prev => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
  };

  const removeFromCart = (itemId) => {
    setCart(prev => {
      const next = { ...prev };
      if (next[itemId] > 1) next[itemId]--;
      else delete next[itemId];
      return next;
    });
  };

  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);

  const handleOrderSuccess = () => {
    setCart({});
    setShowCart(false);
    setOrderSuccess(true);
    setSubTab('orders');
    setTimeout(() => setOrderSuccess(false), 3000);
  };

  const subTabs = [
    { key: 'products', label: t.stProducts },
    { key: 'orders',   label: t.stOrders },
    { key: 'credits',  label: t.stCredits },
  ];

  return (
    <div className="store-tab">
      {showCart && (
        <CartModal
          cart={cart}
          items={items}
          user={user}
          lang={lang}
          onClose={() => setShowCart(false)}
          onSuccess={handleOrderSuccess}
        />
      )}

      <div className="store-header">
        <div className="ac-sub-tabs" style={{ borderBottom: 'none', flex: 1 }}>
          {subTabs.map(s => (
            <button key={s.key} className={`ac-sub-tab${subTab === s.key ? ' active' : ''}`} onClick={() => setSubTab(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        {cartCount > 0 && (
          <button className="cart-btn" onClick={() => setShowCart(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            <span className="cart-count">{cartCount}</span>
          </button>
        )}
      </div>
      <div className="store-header-border" />

      {orderSuccess && (
        <div className="order-success-banner">{t.stOrderPlaced}</div>
      )}

      {subTab === 'products' && (
        <div className="product-grid">
          {loading ? (
            <div className="ac-loading"><span /><span /><span /></div>
          ) : items.length === 0 ? (
            <div className="ac-empty">{t.stNoProducts}</div>
          ) : (
            items.map(item => {
              const qty = cart[item.id] || 0;
              const inStock = item.stock_quantity == null || item.stock_quantity > 0;
              return (
                <div key={item.id} className="product-card">
                  {item.image_url && (
                    <img src={item.image_url} className="product-img" alt={item.name_zh || item.name_en} />
                  )}
                  <div className="product-body">
                    <div className="product-name">{item.name_zh || item.name_en || item.key_name}</div>
                    {item.desc_zh && <div className="product-desc">{item.desc_zh}</div>}
                    <div className="product-price-row">
                      {item.price_cny && <span className="product-price">{t.stCnyPrice(item.price_cny)}</span>}
                      {item.price_credits && <span className="product-price-alt">{t.stCreditPrice(item.price_credits)}</span>}
                    </div>
                    {item.stock_quantity != null && (
                      <div className="product-stock">
                        {inStock ? t.stInStock(item.stock_quantity) : t.stOutOfStock}
                      </div>
                    )}
                    <div className="product-cart-row">
                      {qty > 0 ? (
                        <>
                          <button className="cart-qty-btn" onClick={() => removeFromCart(item.id)}>−</button>
                          <span className="cart-qty-val">{qty}</span>
                          <button className="cart-qty-btn" onClick={() => addToCart(item)} disabled={!inStock}>+</button>
                        </>
                      ) : (
                        <button className="product-add-btn" onClick={() => addToCart(item)} disabled={!inStock}>
                          {t.stAddToCart}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {subTab === 'orders' && <OrdersView user={user} lang={lang} />}
      {subTab === 'credits' && <CreditsView user={user} lang={lang} />}
    </div>
  );
}
