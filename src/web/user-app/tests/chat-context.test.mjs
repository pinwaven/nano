import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSendSpec, filterPendingCoachEchoes } from '../src/chat/chat-context.js';

test('managed-customer chat asks Viva as the coach', () => {
  assert.deepEqual(chatSendSpec({
    coachMode: true,
    user: { user_id: 'managed-1', account_type: 'managed' },
    text: 'How is this customer doing?',
  }), {
    path: '/chat',
    body: {
      openid: 'managed-1', message: 'How is this customer doing?',
      speaker: 'coach', client: 'coach',
    },
  });
});

test('regular-client chat writes a coach instruction without impersonating the user', () => {
  assert.deepEqual(chatSendSpec({
    coachMode: true,
    user: { user_id: 'regular-1', account_type: 'regular' },
    text: 'First line\nSecond line',
  }), {
    path: '/coach-instruction',
    body: { openid: 'regular-1', instruction: 'First line Second line' },
  });
});

test('the regular user chat request remains unchanged', () => {
  assert.deepEqual(chatSendSpec({
    user: { user_id: 'self-1' },
    text: 'Hello',
  }), {
    path: '/chat',
    body: { openid: 'self-1', message: 'Hello', client: 'miniapp' },
  });
});

test('the durable poll consumes one optimistic coach echo without hiding later messages', () => {
  const pending = ['Run formulation'];
  const fresh = filterPendingCoachEchoes([
    { id: 1, role: 'coach', content: 'Run formulation' },
    { id: 2, role: 'ai', content: 'Working' },
    { id: 3, role: 'coach', content: 'Run formulation' },
  ], pending, true);
  assert.deepEqual(fresh.map(row => row.id), [2, 3]);
  assert.deepEqual(pending, []);
});
