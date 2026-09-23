'use strict';

// What a per-user session (`u.` token, lib/auth.js) may do. Two checks, both deny-by-default:
//
//   1. The route must be on USER_ROUTES — every call the miniapp and the web user-app make,
//      nothing else. Admin routes that never called requireAdminTab were reachable by anyone
//      holding the shared app bearer; a user session reaches none of them.
//   2. Every user the request names — `openid` / `user_id` / `user_ids` in the query or body,
//      and `:user` path segments — must be the caller, a client of one of the caller's coach
//      rows (users.coach_id), or, for a channel admin, a user in the same channel. Every
//      `coach_id` must be one of the caller's own coach rows. A superadmin (users.roles) may
//      name anyone — the miniapp's sandbox "log in as" depends on it.
//
// Identity is checked, not rewritten: the coach panel legitimately names its clients, so
// overriding openid with the caller would break it. A route that names a record only by id
// (a coach note, an invitation, an order) declares an `owner` query, and the owner is checked
// like any other named user. Routes that name a record AND an openid rely on the handler
// scoping the record to that openid (health documents, ECG, plan reminders do).
//
// Only the path is checked, never a request made on someone's behalf elsewhere: this layer
// cannot see into /chat's LLM tools, which already scope every read to the turn's openid.

const { pool } = require('./db');

// [METHOD, path, options]. Path segments: `:user` carries a user id and is checked like
// `openid`; `:coach` carries a coaches.id and is checked like `coach_id`; any other `:name`
// is a numeric record id, unchecked unless `owner` says whose it is. Options:
//   roles — the caller must hold one of these users.roles (the Kino simulator: admins only).
//   owner — SQL resolving the record the request names to the user who owns it ($1 = the value
//           at `from`, a path param name or 'body.<key>'); that user is then checked like an
//           openid. For routes that name a record by id and no user at all.
//   ownerCoach — same, resolving to a coaches.id checked like coach_id.
//   body — the only body keys a user session may send; others are dropped before the handler
//          runs. For handlers that also serve the admin panel (PUT /users writes roles).
//   values — allowed values for a body key; anything else is refused.
//   newAccountMinutes — the caller's own account must be younger than this.
//   query — a pattern each named query param must match when present.
// Every route either client calls is here; everything else is refused.
const ADMIN_ROLES = ['admin', 'superadmin'];
const USER_ROUTES = [
    // ── session / identity ──
    ['POST', '/session/refresh'],
    ['GET', '/users/:user'],
    // Profile fields only: handlePutUser also writes roles / channel_id / coach_id / phone /
    // email for the admin panel. Phone and email change through the OTP binds.
    ['PUT', '/users/:user', { body: ['nickname', 'gender', 'birth_date', 'language', 'bio_data', 'avatar_url', 'avatar_character'] }],
    ['PATCH', '/users/:user', { body: ['theme', 'text_scale', 'wearable'] }],
    // verify-phone: cancelling a brand-new signup deletes it — never an established account.
    ['DELETE', '/users/:user', { newAccountMinutes: 60 }],
    ['POST', '/heartbeat'],
    ['GET', '/viva-subscription-status'], ['POST', '/viva-subscription-redeem'],
    ['GET', '/credits/balance'],
    ['POST', '/webview-token'],
    ['POST', '/validate-invite'], ['POST', '/resolve-phone'],
    ['GET', '/phone-otp/list'], ['POST', '/phone-otp/bind'], ['POST', '/phone-otp/set-primary'],
    ['POST', '/phone-otp/remove'], ['POST', '/phone-otp/accept-unverified'],
    ['GET', '/email-otp/list'], ['POST', '/email-otp/bind'], ['POST', '/email-otp/set-primary'], ['POST', '/email-otp/remove'],
    ['POST', '/qr-login/confirm'],   // checked here once it leaves PUBLIC_PATHS (index.js)
    ['POST', '/avatar-generation/presign'], ['POST', '/avatar-generation'], ['GET', '/avatar-generation'],
    ['POST', '/avatar-generation/apply'],

    // ── chat ──
    ['POST', '/chat'], ['POST', '/chat-messages'], ['GET', '/chat-history'], ['GET', '/notifications'],
    ['GET', '/programs/my'], ['GET', '/programs/lesson-url'], ['POST', '/programs/day/start-checkin'],
    ['GET', '/pending-questionnaires'],
    ['PATCH', '/questionnaire-assignments/:id', { owner: 'SELECT user_id FROM questionnaire_assignments WHERE id::text = $1', from: 'id' }],
    ['POST', '/questionnaire-responses', { owner: 'SELECT user_id FROM questionnaire_assignments WHERE id::text = $1', from: 'body.assignment_id' }],
    ['POST', '/formula-dots'], ['POST', '/health-advice'],
    // action=get signs a download for ANY key in the bucket (other users' documents included);
    // the only keys either client reads are academy lessons, library files and certificates.
    ['GET', '/oss/presign', { query: { key: /^academy\/(?!.*\.\.)[\w./-]+$/, category: /^user-images$/ } }],
    ['POST', '/analyze-image'], ['POST', '/health-reports'],
    ['POST', '/kino-scan'], ['GET', '/formulation-orders'], ['POST', '/formulation-submit'],

    // ── Kino simulator (pages/main, admins only) ──
    ['GET', '/kino-devices', { roles: ADMIN_ROLES }], ['GET', '/kino-chip', { roles: ADMIN_ROLES }],
    ['POST', '/kino-result', { roles: ADMIN_ROLES }],

    // ── health ──
    ['GET', '/health-twin'], ['GET', '/lab-history'], ['GET', '/health-reports'],
    ['GET', '/health-reports/:id', { owner: 'SELECT user_id FROM health_reports WHERE id::text = $1', from: 'id' }],
    ['GET', '/user-facts'], ['POST', '/user-facts'],
    ['DELETE', '/user-facts/:id', { owner: 'SELECT user_id FROM user_memory_facts WHERE id::text = $1', from: 'id' }],
    ['GET', '/food-sensitivity'], ['GET', '/twin-reports'], ['GET', '/twin-reports/file'],
    ['GET', '/health-events'], ['POST', '/health-events/sync'], ['GET', '/wearable-insights'],
    ['GET', '/ecg'], ['POST', '/ecg'], ['GET', '/ecg/:id/waveform'], ['DELETE', '/ecg/:id'],
    ['GET', '/ppg'], ['POST', '/ppg'], ['GET', '/ppg/:id/waveform'], ['DELETE', '/ppg/:id'],
    ['GET', '/biomarkers'], ['POST', '/biomarkers'],
    ['GET', '/health-documents'], ['GET', '/health-documents/presign'], ['POST', '/health-documents'],
    ['PATCH', '/health-documents/:id'], ['POST', '/health-documents/:id/extract'],
    ['DELETE', '/health-documents/:id/extraction'], ['DELETE', '/health-documents/:id'], ['GET', '/health-documents/:id/url'],
    ['GET', '/viva-ag/formulation'], ['GET', '/viva-ag/jobs'], ['POST', '/viva-ag/jobs'],
    ['GET', '/viva-ag/jobs/result-url'], ['POST', '/viva-ag/jobs/cancel'],

    // ── plans, dots, events ──
    ['GET', '/health-plans'], ['GET', '/health-plan-templates'], ['POST', '/health-plans'],
    ['GET', '/health-plans/:id', { owner: 'SELECT user_id FROM health_plans WHERE id::text = $1', from: 'id' }],
    ['PUT', '/health-plans/:id', { owner: 'SELECT user_id FROM health_plans WHERE id::text = $1', from: 'id' }],
    ['POST', '/health-plans/:id/checkin', { owner: 'SELECT user_id FROM health_plans WHERE id::text = $1', from: 'id' }],
    ['GET', '/reminders'], ['POST', '/reminders'], ['PATCH', '/plan-reminders/:id'],
    ['GET', '/events'], ['POST', '/event-signups'], ['DELETE', '/event-signups/:id'],
    ['POST', '/box-claim'], ['GET', '/nutrition-plan'], ['POST', '/formulation-redeem'],
    ['GET', '/my-cartridges'], ['POST', '/dispense'], ['POST', '/cartridge-insert'],

    // ── programs (coach enrolls a client) ──
    ['GET', '/programs/coach'], ['POST', '/programs/enroll'], ['PUT', '/programs/enrollment'],

    // ── learn ──
    ['GET', '/academy/courses'], ['GET', '/academy/library'], ['GET', '/academy/learning-paths'],
    ['GET', '/academy/progress'], ['POST', '/academy/progress'],
    ['GET', '/academy/coach-dashboard'], ['GET', '/academy/coach-certifications'],
    ['GET', '/academy/lessons'], ['GET', '/academy/lessons/:id'], ['POST', '/academy/quiz-attempts'],
    ['GET', '/academy/library/:id/content'],
    ['GET', '/digital-assets'], ['GET', '/kino-upgrade'],

    // ── store (non-GCN channels) ──
    ['GET', '/store-items'], ['GET', '/my-orders'], ['POST', '/orders/batch'],
    ['PUT', '/orders/:id', { owner: 'SELECT user_id FROM orders WHERE id::text = $1', from: 'id', body: ['status'], values: { status: ['cancelled'] } }],

    // ── coach panel (pages/coach) ──
    ['GET', '/coach-users/:coach'], ['GET', '/my-coach'], ['GET', '/coach-earnings'],
    ['GET', '/invitations'],
    ['POST', '/invitations', { roles: ['coach', ...ADMIN_ROLES], values: { type: ['coach'] } }],
    ['PATCH', '/invitations/:id', { owner: 'SELECT created_by FROM invitations WHERE id::text = $1', from: 'id', body: ['note'] }],
    ['DELETE', '/invitations/:id', { owner: 'SELECT created_by FROM invitations WHERE id::text = $1', from: 'id' }],
    ['GET', '/coach-user-chat'], ['POST', '/coach-instruction'],
    ['GET', '/coach-notes'], ['POST', '/coach-notes'],
    ['PUT', '/coach-notes/:id', { ownerCoach: 'SELECT coach_id::text FROM coach_client_notes WHERE id::text = $1', from: 'id' }],
    ['DELETE', '/coach-notes/:id', { ownerCoach: 'SELECT coach_id::text FROM coach_client_notes WHERE id::text = $1', from: 'id' }],
    ['GET', '/client-goals'], ['POST', '/client-goals'], ['POST', '/client-pipeline'],
    ['GET', '/coach-activity-feed'], ['GET', '/appointments/upcoming'], ['POST', '/appointments'], ['GET', '/coach-kpis'],
    ['GET', '/questionnaires'], ['GET', '/questionnaire-responses'], ['POST', '/questionnaire-assignments'],
];

// Request keys that name a user / a coaches.id / a channel. created_by, assigned_by and
// coach_user_id are the coach panel naming its own user; channel_id must be the caller's own.
const USER_ID_KEYS = ['openid', 'user_id', 'created_by', 'assigned_by', 'coach_user_id'];
const USER_ID_LIST_KEYS = ['user_ids'];
const COACH_ID_KEYS = ['coach_id'];
const CHANNEL_ID_KEYS = ['channel_id'];

function compileRoutes(routes) {
    return routes.map(([method, pattern, options = {}]) => {
        const names = [];
        const source = pattern.split('/').map(seg => {
            if (!seg.startsWith(':')) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const name = seg.slice(1);
            names.push(name);
            // Narrow on purpose: the router matches with includes(), so a free-text segment
            // ("/health-reports/channels") could land in another route's handler.
            return name === 'user' ? '([A-Za-z0-9_-]+)' : '(\\d+)';
        }).join('/');
        return { method, pattern, names, options, re: new RegExp(`^${source}$`) };
    });
}

const COMPILED = compileRoutes(USER_ROUTES);

function matchUserRoute(method, path, compiled = COMPILED) {
    for (const r of compiled) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return { pattern: r.pattern, params, options: r.options };
    }
    return null;
}

// Every user id and coach id a request names. Values the handlers would treat as absent
// (empty, null) are skipped — they are not a claim about anyone.
function collectIdentityClaims(route, query, body) {
    const userIds = new Set();
    const coachIds = new Set();
    const channelIds = new Set();
    const add = (set, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') set.add(String(v).trim()); };
    for (const src of [query || {}, (body && typeof body === 'object' && !Buffer.isBuffer(body)) ? body : {}]) {
        for (const k of USER_ID_KEYS) add(userIds, src[k]);
        for (const k of USER_ID_LIST_KEYS) {
            const v = src[k];
            const list = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
            list.forEach(x => add(userIds, x));
        }
        for (const k of COACH_ID_KEYS) add(coachIds, src[k]);
        for (const k of CHANNEL_ID_KEYS) add(channelIds, src[k]);
    }
    if (route && route.params.user !== undefined) add(userIds, route.params.user);
    if (route && route.params.coach !== undefined) add(coachIds, route.params.coach);
    return { userIds: [...userIds], coachIds: [...coachIds], channelIds: [...channelIds] };
}

// The caller as the DB sees it right now. A merged-away account follows its merge target, the
// same way every login path resolves it; a user who no longer exists has no session.
async function loadCaller(userId) {
    const { rows } = await pool.query(
        `SELECT u.user_id, u.external_id, u.roles, u.channel_id, u.merged_into_user_id, u.created_at,
                COALESCE(ARRAY(SELECT c.id::text FROM coaches c WHERE c.user_id = u.user_id), '{}') AS coach_ids
           FROM users u WHERE u.user_id = $1`,
        [userId]
    );
    const row = rows[0];
    if (!row) return null;
    if (row.merged_into_user_id && row.merged_into_user_id !== userId) return loadCaller(row.merged_into_user_id);
    return { ...row, roles: row.roles || [], coach_ids: row.coach_ids || [] };
}

async function resolveTarget(id) {
    const { rows } = await pool.query(
        `SELECT user_id, external_id, coach_id::text AS coach_id, channel_id
           FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

function isSelf(caller, id) {
    return id === caller.user_id || (caller.external_id && id === caller.external_id);
}

// Returns null when allowed, otherwise { statusCode: 403, error, reason }.
async function authorizeUserRequest({ caller, method, path, query, body }) {
    const deny = (reason, detail) => {
        console.log(JSON.stringify({ level: 'WARN', msg: 'user_session_denied', data: { reason, method, path, user_id: caller.user_id, ...detail } }));
        return { statusCode: 403, success: false, error: 'Forbidden', reason };
    };
    const route = matchUserRoute(method, path);
    if (!route) return deny('route_not_allowed');

    const isSuperadmin = caller.roles.includes('superadmin');
    const { roles, owner, ownerCoach, from, body: bodyKeys, values, newAccountMinutes, query: queryPatterns } = route.options;
    if (roles && !roles.some(r => caller.roles.includes(r))) return deny('role_required');
    if (queryPatterns) {
        for (const [k, re] of Object.entries(queryPatterns)) {
            const v = (query || {})[k];
            if (v !== undefined && v !== '' && !re.test(String(v))) return deny('query_not_allowed', { key: k });
        }
    }
    const bodyObj = (body && typeof body === 'object' && !Buffer.isBuffer(body)) ? body : null;
    if (values && bodyObj) {
        for (const [k, allowed] of Object.entries(values)) {
            if (bodyObj[k] !== undefined && !allowed.includes(bodyObj[k])) return deny('value_not_allowed', { key: k });
        }
    }
    // Drop the body keys this route does not take from a user session — before collecting the
    // identity claims, so a dropped key (verify-phone resends the user's own coach_id) is not
    // read as a claim. Mutates the parsed body the router is about to hand the handler.
    if (bodyKeys && bodyObj) {
        for (const k of Object.keys(bodyObj)) {
            if (k !== 'sandbox' && !bodyKeys.includes(k)) delete bodyObj[k];
        }
    }
    if (newAccountMinutes && !isSuperadmin) {
        const ageMs = Date.now() - new Date(caller.created_at).getTime();
        if (!(ageMs < newAccountMinutes * 60000)) return deny('account_not_new');
    }

    const { userIds, coachIds, channelIds } = collectIdentityClaims(route, query, body);

    // A record named only by id: whoever owns it is named by the request too.
    if ((owner || ownerCoach) && !isSuperadmin) {
        const key = from.startsWith('body.') ? (body || {})[from.slice(5)] : route.params[from];
        if (key !== undefined && key !== null && String(key) !== '') {
            const { rows } = await pool.query(owner || ownerCoach, [String(key)]);
            // A record that does not exist is the handler's 404, not this layer's 403; one that
            // exists with no owner (an invitation made in the admin panel) is nobody's to touch.
            if (rows[0]) {
                const val = Object.values(rows[0])[0];
                if (val === null || val === undefined) return deny('record_has_no_owner');
                (owner ? userIds : coachIds).push(String(val));
            }
        }
    }

    // A superadmin may name anyone; the body limits below still apply.
    if (!isSuperadmin) {
        for (const ch of channelIds) {
            if (caller.channel_id == null || String(caller.channel_id) !== ch) return deny('channel_id_not_caller', { channel_id: ch });
        }
        for (const cid of coachIds) {
            if (!caller.coach_ids.includes(cid)) return deny('coach_id_not_caller', { coach_id: cid });
        }
        for (const id of userIds) {
            if (isSelf(caller, id)) continue;
            const target = await resolveTarget(id);
            if (!target) return deny('unknown_user', { target: id });
            if (target.coach_id && caller.coach_ids.includes(target.coach_id)) continue;
            if (caller.roles.includes('admin') && caller.channel_id != null && target.channel_id === caller.channel_id) continue;
            return deny('not_your_user', { target: target.user_id });
        }
    }
    return null;
}

module.exports = {
    USER_ROUTES,
    compileRoutes,
    matchUserRoute,
    collectIdentityClaims,
    loadCaller,
    authorizeUserRequest,
};
