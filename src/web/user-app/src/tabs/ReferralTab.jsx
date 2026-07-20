import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import { fmtDate } from '../utils.js';

const API = '/api';

export default function ReferralModal({ user, lang, onClose }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user?.user_id) return;
    axios.get(`${API}/my-referrals?user_id=${encodeURIComponent(user.user_id)}`)
      .then(r => { if (r.data.success) setData(r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.user_id]);

  const code = data?.referral_code || user?.referral_code || '';
  const inviteUrl = code ? `https://nano.fros.cc/app/?ref=${encodeURIComponent(code)}` : '';

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const share = () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      navigator.share({ title: t.referralShareTitle, url: inviteUrl }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(inviteUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card referral-card" onClick={e => e.stopPropagation()}>
        <div className="referral-modal-header">
          <span className="modal-title">{t.referralTitle}</span>
          <button className="referral-close-btn" onClick={onClose} aria-label={t.cancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="ac-loading"><span /><span /><span /></div>
        ) : (
          <>
            <div className="referral-code-card">
              <div className="referral-code-label">{t.referralYourCode}</div>
              <div className="referral-code-value">{code || '—'}</div>
              <div className="referral-code-actions">
                <button className="modal-btn modal-btn--ghost" onClick={copyCode} disabled={!code}>
                  {copied ? t.referralCopied : t.referralCopy}
                </button>
                <button className="modal-btn modal-btn--primary" onClick={share} disabled={!code}>
                  {t.referralShare}
                </button>
              </div>
            </div>

            <div className="referral-stats-row">
              <div className="referral-stat">
                <div className="referral-stat-val">{data?.total_referred ?? 0}</div>
                <div className="referral-stat-label">{t.referralTotalReferred}</div>
              </div>
              <div className="referral-stat">
                <div className="referral-stat-val">{data?.total_commission_earned ?? 0}</div>
                <div className="referral-stat-label">{t.referralTotalEarned}</div>
              </div>
            </div>

            <div className="referral-list-title">{t.referralListTitle}</div>
            {(data?.referrals || []).length === 0 ? (
              <div className="ac-empty">{t.referralNoReferrals}</div>
            ) : (
              <div className="referral-list">
                {data.referrals.map((r, i) => (
                  <div key={r.user_id || i} className="referral-row">
                    <div className="referral-row-left">
                      <span className="referral-row-name">{r.nickname || r.user_id}</span>
                      <span className="referral-row-date">{t.referralJoined}: {fmtDate(r.joined_at, lang)}</span>
                    </div>
                    <span className="referral-row-amount">
                      {r.commission_earned > 0 ? `+${r.commission_earned}` : r.commission_earned}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="referral-how">
              <div className="referral-how-title">{t.referralHowTitle}</div>
              <div className="referral-how-step"><span className="referral-how-num">1</span>{t.referralHow1}</div>
              <div className="referral-how-step"><span className="referral-how-num">2</span>{t.referralHow2}</div>
              <div className="referral-how-step"><span className="referral-how-num">3</span>{t.referralHow3}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
