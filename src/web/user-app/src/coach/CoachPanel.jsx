import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, storage } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';
import ChatTab from '../chat/ChatTab.jsx';
import { createController } from './controller.js';
import View from './generated/View.jsx';
import './generated/coach.css';
import './coach.css';

export default function CoachPanel() {
  const app = useApp();
  const appRef = useRef(app); appRef.current = app;
  const [page, setPage] = useState(null);
  const [chatHost, setChatHost] = useState(null);
  const rootRef = useRef(null);
  const [, render] = useState(0);
  useEffect(() => {
    const controller = createController(appRef, () => render(n => n + 1), { storage });
    setPage(controller.page);
    controller.page.onLoad();
    const refresh = () => { if (document.visibilityState === 'visible') controller.page.onShow(); };
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.dispose(); document.removeEventListener('visibilitychange', refresh); };
  }, [app.user?.user_id, app.lang]);
  // Recreate translations/tool labels through the same source initialization on next entry.
  const fire = async (name, event = {}, dataset = {}, stop = false) => {
    if (stop) event.stopPropagation?.();
    const detail = event.detail && typeof event.detail === 'object' ? event.detail : { value: event.target?.value };
    try { await page[name]?.({ currentTarget: { dataset }, detail, touches: event.touches, changedTouches: event.changedTouches }); }
    catch { ui.toast(page.data.t.networkError); }
  };
  useEffect(() => {
    if (!page) return;
    page.setData({ theme: app.theme, textScale: app.textScale });
  }, [page, app.theme, app.textScale]);
  useLayoutEffect(() => {
    if (!page?.data.detailOpen || page.data.detailTab !== 'chat') { setChatHost(null); return; }
    setChatHost(rootRef.current?.querySelector('.chat-panel') || null);
  }, [page, page?.data.detailOpen, page?.data.detailTab, page?.data.detailClient?.user_id]);
  if (!page) return null;
  const client = page.data.detailClient;
  const coachContext = client ? { targetUser: client, coachMode: true, coachId: page.data.coachId,
    placeholder: client.account_type === 'managed' ? page.data.t.mc.askPh : page.data.t.msgPh } : null;
  const actions = client ? <CoachChatActions page={page} fire={fire} /> : null;
  return <div className="web-coach" ref={rootRef}>
    <View page={page} fire={fire} />
    {chatHost && coachContext && createPortal(
      <div className="coach-chat-mount"><ChatTab context={coachContext} footerActions={actions} /></div>,
      chatHost,
    )}
    <button className="coach-refresh" title={page.data.t.refresh} aria-label={page.data.t.refresh} onClick={() => fire('handleRefresh')}>↻</button>
    {page.data.apptFormOpen && <AppointmentForm page={page} fire={fire} />}
  </div>;
}

function CoachChatActions({ page, fire }) {
  const { detailClient: client, t } = page.data;
  return <div className="coach-chat-actions">
    <button type="button" onClick={() => fire('openReminderComposer')}>{t.setReminder}</button>
    {client?.account_type === 'managed' && <button type="button" onClick={() => fire('openRedeemForm')}>{t.mc.redeem}</button>}
    {client?.account_type === 'managed' && <button type="button" onClick={() => fire('scanBoxForCustomer')}>{t.mc.boxScan}</button>}
  </div>;
}

// Miniapp has the appointment handlers but omits the form from WXML. Complete the browser entry.
function AppointmentForm({ page, fire }) {
  const d = page.data, t = d.t;
  return <div className={`coach-appointment overlay-mask ${d.theme === 'light' ? 'theme-light' : ''}`}><div className="overlay-panel">
    <div className="overlay-header"><span className="overlay-title">{t.newAppt}</span><button className="overlay-close" onClick={() => fire('closeApptForm')}>✕</button></div>
    <div className="overlay-scroll coach-appointment-body">
      <label className="form-row">{t.tabs.clients}<select className="form-input" value={d.apptClientId} onChange={e => page.setData({ apptClientId: e.target.value })}><option value="">—</option>{d.clients.map(c => <option key={c.user_id} value={c.user_id}>{c.nickname}</option>)}</select></label>
      {[['apptTitleText', t.apptTitle, 'text'], ['apptDate', t.apptDate, 'date'], ['apptTime', t.apptTime, 'time'], ['apptLink', d.lang === 'zh' ? '链接' : 'Link', 'url']].map(([key, label, type]) => <label key={key} className="form-row">{label}<input className="form-input" type={type} value={d[key]} onChange={e => page.setData({ [key]: e.target.value })} /></label>)}
      <select className="form-input" aria-label={d.lang === 'zh' ? '预约方式' : 'Format'} value={d.apptFormat} onChange={e => page.setData({ apptFormat: e.target.value })}>{Object.entries(t.apptFormats).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </div>
    <div className="overlay-footer"><button className="overlay-cancel-btn" onClick={() => fire('closeApptForm')}>{t.apptCancel}</button><button className="overlay-confirm-btn" disabled={d.apptBusy || !d.apptClientId || !d.apptTitleText.trim()} onClick={() => fire('submitAppt')}>{d.apptBusy ? t.loading : t.apptCreate}</button></div>
  </div></div>;
}
