export function chatSendSpec({ coachMode = false, user, text }) {
  const openid = user?.user_id;
  if (coachMode && user?.account_type !== 'managed') {
    return { path: '/coach-instruction', body: { openid, instruction: text.replace(/\n+/g, ' ') } };
  }
  return {
    path: '/chat',
    body: coachMode
      ? { openid, message: text, speaker: 'coach', client: 'coach' }
      : { openid, message: text, client: 'miniapp' },
  };
}

export function filterPendingCoachEchoes(rows, pending, coachMode) {
  if (!coachMode) return rows;
  return rows.filter(row => {
    if (row.role !== 'coach') return true;
    const key = String(row.content || '').replace(/\s+/g, ' ').trim();
    const i = pending.indexOf(key);
    if (i < 0) return true;
    pending.splice(i, 1);
    return false;
  });
}
