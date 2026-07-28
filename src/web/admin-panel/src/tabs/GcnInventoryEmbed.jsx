import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../shared.jsx';

// Embeds GCN's own admin console (aeviva/dashboard-admin.html) for a GCN-linked
// channel's SKU/inventory/order data — nano's native Inventory UI doesn't apply
// there, GCN is the real source of truth. Pre-authenticated via a one-time wvt
// token minted server-side (POST /api/admin-webview-token), mirroring the
// miniapp's consumer webview SSO handoff but keyed by admin identity instead
// of openid. See CLAUDE.md §19 for the cross-repo contract.
export default function GcnInventoryEmbed({ channelId }) {
  const { t } = useLang();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setUrl('');
    setError('');
    axios.post('/api/admin-webview-token', { channel_id: channelId })
      .then(res => {
        if (cancelled) return;
        const wvt = res.data?.wvt;
        if (!wvt) { setError(t.inventory.gcnLoadFailed); return; }
        const host = window.location.hostname.includes('nano-dev') ? 'https://edge-dev.gcn.net' : 'https://edge.gcn.net';
        setUrl(`${host}/aeviva/dashboard-admin.html?wvt=${wvt}`);
      })
      .catch(() => { if (!cancelled) setError(t.inventory.gcnLoadFailed); });
    return () => { cancelled = true; };
  }, [channelId, t]);

  if (error) {
    return <div style={{ flex: 1, textAlign: 'center', padding: '60px 28px', color: '#f87171' }}>{error}</div>;
  }
  if (!url) {
    return <div style={{ flex: 1, textAlign: 'center', padding: '60px 28px', color: '#64748b' }}>{t.topbar.loading}</div>;
  }
  // .content (the flex parent this renders into) is a flex column filling the viewport
  // below the topbar — flex:1 lets the iframe claim all remaining height itself rather
  // than guessing a fixed calc(100vh - Npx) offset, which drifted out of sync with the
  // actual chrome height (topbar + content padding + the superadmin channel-selector row)
  // and left blank space below the iframe.
  return (
    <iframe
      title="gcn-inventory"
      src={url}
      style={{ width: '100%', flex: 1, minHeight: 600, border: 'none' }}
    />
  );
}
