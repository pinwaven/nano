import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import { fmtDateTime } from '../utils.js';

const API = '/api';

export default function EventsView({ user, lang }) {
  const { t } = useLang();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const load = () => {
    if (!user?.channel_id) { setLoading(false); return; }
    axios.get(`${API}/events?openid=${encodeURIComponent(user.user_id)}&channel_id=${user.channel_id}`)
      .then(r => setEvents(r.data.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.user_id, user?.channel_id]);

  const signup = async (ev) => {
    setActing(ev.id);
    try {
      await axios.post(`${API}/events/${ev.id}/signups`, { user_id: user.user_id });
      load();
    } catch { /* silent */ }
    setActing(null);
  };

  const cancel = async (ev) => {
    setActing(ev.id);
    try {
      await axios.delete(`${API}/events/${ev.id}/signups?openid=${encodeURIComponent(user.user_id)}`);
      load();
    } catch { /* silent */ }
    setActing(null);
  };

  if (loading) return <div className="ac-loading"><span /><span /><span /></div>;
  if (!events.length) return <div className="ac-empty">{t.evNoEvents}</div>;

  return (
    <div className="ev-list">
      {events.map(ev => {
        const signedUp = ev.signed_up;
        const isFull = ev.capacity && parseInt(ev.signup_count, 10) >= parseInt(ev.capacity, 10);
        return (
          <div key={ev.id} className={`ev-card${signedUp ? ' ev-card--mine' : ''}`}>
            <div className="ev-card-title">{ev.title}</div>
            {ev.description && <div className="ev-card-desc">{ev.description}</div>}
            <div className="ev-card-meta">
              <div className="ev-meta-row">
                <span className="ev-meta-key">{t.evDate}</span>
                <span className="ev-meta-val">{fmtDateTime(ev.scheduled_at, lang)}</span>
              </div>
              {ev.location && (
                <div className="ev-meta-row">
                  <span className="ev-meta-key">{t.evLocation}</span>
                  <span className="ev-meta-val">{ev.location}</span>
                </div>
              )}
              {ev.capacity && (
                <div className="ev-meta-row">
                  <span className="ev-meta-key">已报名</span>
                  <span className="ev-meta-val">{t.evCapacity(ev.signup_count, ev.capacity)}</span>
                </div>
              )}
            </div>
            <div className="ev-card-footer">
              {signedUp ? (
                <>
                  <span className="ev-badge-signed">{t.evSignedUp}</span>
                  <button className="ev-cancel-btn" onClick={() => cancel(ev)} disabled={acting === ev.id}>
                    {acting === ev.id ? '…' : t.evCancelSignup}
                  </button>
                </>
              ) : isFull ? (
                <span className="ev-badge-full">{t.evFull}</span>
              ) : (
                <button className="ev-signup-btn" onClick={() => signup(ev)} disabled={acting === ev.id}>
                  {acting === ev.id ? '…' : t.evSignUp}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
