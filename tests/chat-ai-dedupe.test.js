'use strict';

// The miniapp chat tab's cross-channel AI de-dup must drop the SAME reply arriving on its second
// delivery channel, but never a NEW reply that repeats an earlier one word for word.
//
// Live on dev 2026-09-23: 「你是什么大模型？」 then 「你背后是什么模型？」 — Viva answered both
// with identical text, _poll dropped the second as already rendered, and the user saw the typing
// dots vanish with no reply. These tests drive the real pages/main/main.js methods (Page() is
// captured under stubbed wx globals) through that exact sequence.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadPage() {
    const px = new Proxy(function () {}, {
        get: (t, k) => k === 'getAccountInfoSync' ? () => ({ miniProgram: { envVersion: 'develop', version: '' } })
            : k === 'getStorageSync' ? () => null
            : (k === 'getSystemInfoSync' || k === 'getWindowInfo') ? () => ({})
            : px,
        apply: () => px,
    });
    global.wx = px;
    global.getApp = () => ({ globalData: {} });
    global.Component = () => {};
    global.Behavior = o => o;
    global.requirePlugin = () => px;
    let page;
    global.Page = o => { page = o; };
    const file = path.join(ROOT, 'src/mini/nano-miniapp/pages/main/main.js');
    delete require.cache[require.resolve(file)];
    require(file);
    return page;
}

const REPLY = '我是 Viva，Aeviva 精准长寿系统中的专属健康顾问，不是通用大模型。';

// A page instance with the chat state onLoad would set, and a fake server: `notifications` and
// `history` are what the next poll returns; /api/chat answers with `chatResponse`.
function makeCtx(page) {
    const ctx = Object.create(page);
    Object.assign(ctx, {
        // Whatever onLoad would create — a Set before the turn-scoping fix, a Map after — so the
        // same tests can be run against the pre-fix main.js to show they catch the bug.
        _seenIds: new Set(), _renderedAiKeys: page._scopeAiDedupeToTurn ? new Map() : new Set(), _lastMsgId: 100,
        _turnSeq: 0, _aiDedupeSeq: 0, _aiRowFloor: null, _chatWaitStartedAt: null,
        data: { obStep: 'done', messages: [], t: {}, user: { user_id: 'u1' } },
        server: { notifications: [], history: [], chatResponse: {} },
    });
    ctx.setData = function (d) { Object.assign(this.data, d); };
    ctx._scrollBottom = () => {};
    ctx._refreshProgramState = () => {};
    ctx._checkForPendingQuestionnaire = () => {};
    ctx._req = async function (url) {
        if (url.includes('/api/chat-history')) {
            const since = Number(new URL(url).searchParams.get('since_id'));
            const roles = new URL(url).searchParams.get('roles').split(',');
            return { data: { messages: this.server.history.filter(m => m.id > since && roles.includes(m.role)) } };
        }
        if (url.includes('/api/notifications')) {
            const n = this.server.notifications; this.server.notifications = [];
            return { data: { notifications: n } };
        }
        if (url.includes('/api/chat')) return { data: this.server.chatResponse };
        return { data: {} };
    };
    return ctx;
}

const aiBubbles = ctx => ctx.data.messages.filter(m => m.role === 'ai').length;

// One synchronous turn: the server saves the user row + ai reply and a chat_reply notification,
// returns user_message_id, and the client's immediate poll delivers the reply.
async function turn(ctx, { userId, aiId, notifId, text, withId = true }) {
    ctx.server.history.push({ id: userId, role: 'user', content: 'q' }, { id: aiId, role: 'ai', content: text });
    ctx.server.notifications.push({ id: notifId, notification_type: 'chat_reply', content: text });
    ctx.server.chatResponse = { success: true, user_id: 'u1', ...(withId && { user_message_id: userId }) };
    await ctx._sendMessage('q');
    // _sendMessage fires _poll without awaiting it; let it and a second tick run.
    await new Promise(r => setImmediate(r));
    await ctx._poll(ctx.data.user);
}

test('a new reply that repeats the previous one word for word is shown (the 2026-09-23 bug)', async () => {
    const ctx = makeCtx(loadPage());
    await turn(ctx, { userId: 101, aiId: 102, notifId: 1, text: REPLY });
    assert.strictEqual(aiBubbles(ctx), 1);
    await turn(ctx, { userId: 103, aiId: 104, notifId: 2, text: REPLY });
    assert.strictEqual(aiBubbles(ctx), 2, 'the second identical reply was swallowed as a duplicate');
    assert.strictEqual(ctx.data.typing, false);
});

test('the same reply arriving on both channels in one turn is still shown once', async () => {
    const ctx = makeCtx(loadPage());
    await turn(ctx, { userId: 101, aiId: 102, notifId: 1, text: REPLY });
    await turn(ctx, { userId: 103, aiId: 104, notifId: 2, text: REPLY });
    // Both turns delivered on the notification channel AND replayed by the chat_messages
    // catch-up (the wait window was open) — still exactly one bubble per turn.
    await ctx._poll(ctx.data.user);
    assert.strictEqual(aiBubbles(ctx), 2);
});

test('an earlier turn\'s reply still returned by the catch-up is not rendered again', async () => {
    const ctx = makeCtx(loadPage());
    // Turn 1's reply lands via notifications only; the catch-up that tick ran with roles=coach,
    // so _lastMsgId never moved past row 102 and turn 2's catch-up returns it again.
    ctx.server.history.push({ id: 101, role: 'user', content: 'q' }, { id: 102, role: 'ai', content: REPLY });
    ctx.server.notifications.push({ id: 1, notification_type: 'chat_reply', content: REPLY });
    ctx.server.chatResponse = { success: true, user_id: 'u1', user_message_id: 101 };
    await ctx._sendMessage('q');
    await new Promise(r => setImmediate(r));
    assert.strictEqual(aiBubbles(ctx), 1);
    assert.strictEqual(ctx._lastMsgId, 100, 'precondition: the old ai row is still ahead of _lastMsgId');

    await turn(ctx, { userId: 103, aiId: 104, notifId: 2, text: '另一条回复' });
    assert.strictEqual(aiBubbles(ctx), 2, 'row 102 (below the new turn\'s floor) must not be replayed');
});

test('without user_message_id (an older server) the de-dup keeps its old any-turn behaviour', async () => {
    const ctx = makeCtx(loadPage());
    await turn(ctx, { userId: 101, aiId: 102, notifId: 1, text: REPLY, withId: false });
    await turn(ctx, { userId: 103, aiId: 104, notifId: 2, text: REPLY, withId: false });
    assert.strictEqual(aiBubbles(ctx), 1);
});

test('handlePostChat returns the persisted user message id on both waiting paths', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/functions/worker/handlers/chat.js'), 'utf8');
    const body = src.slice(src.indexOf('async function handlePostChat(body)'), src.indexOf('\nasync function handlePostChatMessages'));
    assert.match(body, /INSERT INTO chat_messages \(user_id, role, content, persona_type\) VALUES \(\$1, \$2, \$3, \$4\) RETURNING id',\s*\[user_id, coachSpeaker \? 'coach' : 'user', message, personaType\]/);
    assert.match(body, /processing: true, user_message_id: userMessageId/);
    assert.match(body, /\{ \.\.\.finalized, user_message_id: userMessageId \}/);
});
