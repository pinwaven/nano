// The 兑换码 sheet (main.js:_openCodeSheet / submitFormulationRedeem, main.wxml codeSheetOpen).
// App-level: opened from Plans ▸ Dots (a listed code, or manual entry) and from the chat's
// :::formula card (prefilled with the held code). Shipping is required — the box ships and there
// is no payment step afterwards to collect an address on. No WeChat address book on the web.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';
import { openGcnStoreGated } from '../gcn.js';
import { useDotsData, loadDots } from './dotsStore.js';

const ship = { name: '', phone: '', address: '' }; // remembered across opens, like the miniapp's data fields

export default function CodeRedeemSheet() {
  const app = useApp();
  const { codeSheet, closeCodeSheet, user, t, lang } = app;
  const dots = useDotsData();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!codeSheet) return;
    setCode(codeSheet.code || ''); setError(''); setBusy(false);
    setName(ship.name || user?.nickname || ''); setPhone(ship.phone || user?.phone || ''); setAddress(ship.address || '');
  }, [codeSheet, user]);
  if (!codeSheet) return null;

  const submit = async () => {
    if (busy || !user?.user_id) return;
    const c = code.trim();
    if (!c) { setError(t.codeRequired); return; }
    const n = name.trim(), p = phone.trim(), a = address.trim();
    if (!n || !p || !a) { setError(t.codeShippingRequired); return; }
    ship.name = n; ship.phone = p; ship.address = a;
    const max = codeSheet.max ? Number(codeSheet.max) : null;
    const fits = (dots.proposedTierWidths || []).filter(w => max && w <= max);
    const overTier = max && dots.proposedDistinctDots && dots.proposedDistinctDots > max;
    const content = fits.length ? t.codeTierMatch(Math.max(...fits), max) : overTier ? t.codeOverTier(dots.proposedDistinctDots, max) : t.codeConfirm;
    const { confirm } = await ui.confirm({ title: t.codeSheetTitle, content, confirmText: t.codeSubmitBtn, cancelText: t.codeCancel });
    if (!confirm) return;
    setBusy(true); setError('');
    try {
      const res = await api.post('/formulation-redeem', {
        openid: user.user_id, code: c,
        plan_id: codeSheet.planId || dots.packages.find(x => x.stage === 'proposed')?.plan_id || null,
        shipping_name: n, shipping_phone: p, shipping_address: a,
      }, { timeoutMs: 30000 });
      if (res?.sandbox) { setBusy(false); setError(t.codeSandbox); return; }
      if (!res?.success) {
        const reason = res?.reason;
        if (reason === 'nano_identity_not_linked' || /nano identity not linked/i.test(reason || '')) {
          setBusy(false); closeCodeSheet();
          const r = await ui.confirm({ title: t.codeLinkTitle, content: t.codeLinkDetail, confirmText: t.gotIt, cancelText: t.codeCancel });
          if (r.confirm) openGcnStoreGated(app, { intent: 'redeem_formulation_code' });
          return;
        }
        setBusy(false); setError(t[`codeErr_${reason}`] || t.codeErrGeneric); return;
      }
      setBusy(false); closeCodeSheet();
      ui.toast(res.pending_confirmation ? t.codePending : t.codeOk, { duration: 3000 });
      loadDots(user, lang, t, { force: true });
    } catch { setBusy(false); setError(t.codeErrGeneric); }
  };

  return (
    <div className="guest-sheet-mask" onClick={() => !busy && closeCodeSheet()}>
      <div className="guest-sheet" onClick={e => e.stopPropagation()}>
        <div className="guest-sheet-handle" />
        <span className="guest-sheet-title">{codeSheet.manual ? t.codeSheetTitle : codeSheet.name}</span>
        <span className="guest-sheet-desc">{codeSheet.manual ? t.codeSheetDescManual : t.codeSheetDesc}</span>
        {codeSheet.manual && <input className="viva-redeem-input" autoFocus value={code} placeholder={t.codePlaceholder} onChange={e => { setCode(e.target.value); setError(''); }} />}
        <input className="viva-redeem-input" value={name} placeholder={t.codeNamePlaceholder} onChange={e => setName(e.target.value)} />
        <input className="viva-redeem-input" value={phone} placeholder={t.codePhonePlaceholder} onChange={e => setPhone(e.target.value)} />
        <input className="viva-redeem-input" value={address} placeholder={t.codeAddrPlaceholder} onChange={e => setAddress(e.target.value)} />
        {error && <div className="guest-sheet-error"><span>{error}</span></div>}
        <div className={`guest-sheet-btn${busy ? ' guest-sheet-btn-disabled' : ''}`} onClick={submit}><span>{busy ? '…' : t.codeSubmitBtn}</span></div>
      </div>
    </div>
  );
}
