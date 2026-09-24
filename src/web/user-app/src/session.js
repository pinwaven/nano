// Per-user API session — the twin of the miniapp's utils/session.js. Every login response
// carries `session_token` (the worker signs it; lib/userAccess.js decides per request what it
// may do). It replaces the shared app bearer this bundle used to inline from VITE_API_TOKEN,
// which the server treated as superadmin (TODO.md "Security", phase 3).
//
// localStorage: nano_session (token) + nano_session_at (ms it was saved).
const TOKEN_KEY = 'nano_session';
const SAVED_AT_KEY = 'nano_session_at';
export const SESSION_EXPIRED_EVENT = 'nano:session-expired';

export function getSessionToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function sessionAgeMs() {
  try { return Date.now() - (Number(localStorage.getItem(SAVED_AT_KEY)) || 0); } catch { return Infinity; }
}

export function saveSessionToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

export function clearSessionToken() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(SAVED_AT_KEY); } catch { /* ignore */ }
}

// A 401 means the session is gone (expired or revoked). The app context listens and signs the
// user out; a 403 is one refused request and leaves the session alone.
export function reportAuthFailure() {
  if (!getSessionToken()) return;
  clearSessionToken();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
