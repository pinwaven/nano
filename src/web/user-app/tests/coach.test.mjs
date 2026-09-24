import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createController } from '../src/coach/controller.js';

const managed = { user_id: 'managed-fixture', nickname: 'Test Customer', account_type: 'managed', birth_date: '1980-01-01', gender: 'female', crm_stage: 'lead', crm_tag_objects: [] };
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
function fixture({ coach = { id: 62, channel_id: 7 }, response, lang = 'en' } = {}) {
  const calls = [], toasts = [], values = new Map();
  const storage = { get: k => values.get(k), set: (k,v) => values.set(k,v), remove: k => values.delete(k) };
  const app = { user: { user_id: 'coach-fixture', roles: ['user','coach'], nickname: 'Coach' }, channel: { id:7, name:'SuperiorMed' }, coach, lang, theme:'light', setRoute() {} };
  const uiService = { toast: title => toasts.push(title), confirm: async () => ({ confirm: false }), loading() {} };
  const request = async (url, method, data, opts) => {
    calls.push({url, method, data, opts});
    if (response) { const result = response(url, method, data); if (result) return result; }
    if (url.startsWith('/my-coach')) return { statusCode:200, data:{success:true,coach:{id:62,channel_id:7}} };
    if (url.startsWith('/coach-users/')) return { statusCode:200, data:{users:[managed], managed_customers_enabled:true} };
    return { statusCode:200, data:{success:true, invitations:[], messages:[], customer:managed} };
  };
  const c = createController({current:app}, () => {}, {storage,request,uiService});
  c.page.onLoad();
  return {...c,calls,toasts,storage,app};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('generated view and controller stay synchronized with the miniapp', () => {
  execFileSync(process.execPath, ['scripts/sync-coach-from-miniapp.mjs', '--check'], {cwd:new URL('..',import.meta.url)});
});
test('restores missing coach identity and scopes list to that coach', async t => {
  const f=fixture({coach:null});t.after(f.dispose);await settle();
  assert.equal(f.page.data.coachId,62);assert.equal(f.storage.get('nano_coach').id,62);
  assert.equal(f.page.data.mcEnabled,true);assert.equal(f.page.data.clients[0].user_id,managed.user_id);
  assert.ok(f.calls.some(c=>c.url==='/coach-users/62'));
});
test('client search and stage filters preserve miniapp behavior', async t => {
  const f=fixture();t.after(f.dispose);await settle();
  f.page.onClientSearchInput(event({},'not found'));assert.equal(f.page.data.filteredClients.length,0);
  f.page.clearClientSearch();assert.equal(f.page.data.filteredClients.length,1);
  f.page.setStageFilter(event({stage:'active'}));assert.equal(f.page.data.filteredClients.length,0);
});
test('a refused client list displays failure, not empty success', async t => {
  const f=fixture({response:u=>u.startsWith('/coach-users/')?{statusCode:403,data:{error:'forbidden'}}:null});t.after(f.dispose);await settle();
  assert.equal(f.page.data.clientsLoadState,'failed');assert.equal(f.page.data.mcEnabled,false);
});
test('create validates locally, preserves nested fields and sends coach identity', async t => {
  const f=fixture();t.after(f.dispose);await settle();f.page.openManagedForm();
  await f.page.submitManagedForm();assert.ok(!f.calls.some(c=>c.url==='/managed-customers'));
  f.page.onMcInput(event({field:'last_name'},'Test'));f.page.onMcInput(event({field:'first_name'},'Customer'));
  f.page.onMcDate(event({},'1980-01-01'));f.page.onMcGender(event({},'1'));
  await f.page.submitManagedForm();
  const c=f.calls.find(c=>c.url==='/managed-customers');assert.equal(c.data.coach_id,62);assert.equal(c.data.last_name,'Test');assert.equal(c.data.first_name,'Customer');assert.equal(c.data.gender,'female');assert.equal(f.page.data.mcFormOpen,false);
});
test('edit targets managed customer; server validation keeps form open', async t => {
  const f=fixture({response:u=>u.startsWith('/managed-customers/')?{statusCode:409,data:{success:false,error:'external_ref_in_use'}}:null});t.after(f.dispose);await settle();
  f.page.openManagedForm(event({client:managed}));await f.page.submitManagedForm();
  assert.ok(f.calls.some(c=>c.url==='/managed-customers/managed-fixture'&&c.method==='PUT'));
  assert.equal(f.page.data.mcFormOpen,true);assert.match(f.toasts.at(-1),/already|exists/i);
});
test('managed chat asks Viva as coach about the selected customer', async t => {
  const f=fixture();t.after(f.dispose);await settle();
  f.page.openClientDetail(event({client:managed,tab:'chat'}));f.page.onMsgInput(event({},'Test question'));await f.page.sendMessage();
  const call=f.calls.find(c=>c.url==='/chat');assert.deepEqual(call.data,{openid:managed.user_id,message:'Test question',speaker:'coach',client:'coach'});
  assert.ok(!f.calls.some(c=>c.url==='/coach-instruction'));
});
test('regular-client message uses coach instruction instead of impersonating user', async t => {
  const f=fixture();t.after(f.dispose);await settle();f.page.openClientDetail(event({client:{...managed,account_type:'regular'},tab:'chat'}));
  f.page.onMsgInput(event({},'Test note'));await f.page.sendMessage();
  assert.ok(f.calls.some(c=>c.url==='/coach-instruction'&&c.data.openid===managed.user_id&&c.data.instruction==='Test note'));assert.ok(!f.calls.some(c=>c.url==='/chat'));
});
test('failed notes mutation reports failure and retains draft', async t => {
  const f=fixture({response:(u,m)=>u==='/coach-notes'&&m==='POST'?{statusCode:403,data:{error:'forbidden'}}:null});t.after(f.dispose);await settle();
  f.page.openClientDetail(event({client:managed}));f.page.onNoteTextInput(event({},'Keep this draft'));await f.page.saveNote();
  assert.equal(f.page.data.noteText,'Keep this draft');assert.ok(f.toasts.length);
});
test('only reusable questionnaires can be assigned', async t => {
  const f=fixture({response:u=>u.startsWith('/questionnaires?')?{statusCode:200,data:{questionnaires:['onboarding','custom','dynamic','viva_ag'].map(type=>({id:type,type,is_active:true}))}}:null});t.after(f.dispose);await settle();
  await f.page._loadQuestionnaires();assert.deepEqual(f.page.data.questionnaires.map(q=>q.type),['onboarding','custom']);
});
test('program action targets chosen customer and current coach', async t => {
  const f=fixture();t.after(f.dispose);await settle();f.page.openClientDetail(event({client:managed}));
  await f.page.handleProgramAction(event({program:4,action:'pause'}));
  const c=f.calls.find(c=>c.url==='/programs/enrollment');assert.equal(c.data.openid,managed.user_id);assert.equal(c.data.coach_id,62);assert.equal(c.data.status,'paused');
});
test('redeem requires shipping, then targets customer without changing login', async t => {
  const f=fixture();t.after(f.dispose);await settle();f.page.openClientDetail(event({client:managed}));f.page.openRedeemForm();
  await f.page.submitRedeem();assert.ok(!f.calls.some(c=>c.url==='/formulation-redeem'));
  f.page.setData({redeemForm:{code:'FIXTURE',name:'Test',phone:'13800000000',address:'Fixture only'}});await f.page.submitRedeem();
  const c=f.calls.find(c=>c.url==='/formulation-redeem');assert.equal(c.data.openid,managed.user_id);assert.equal(f.app.user.user_id,'coach-fixture');
});
test('closing panel suppresses late updates and further requests', async () => {
  const f=fixture();await settle();f.dispose();const before=f.page.data;
  f.page.setData({mcFormOpen:true});assert.equal(f.page.data,before);
  await assert.rejects(()=>f.page._req('/api/coach-notes','POST',{}),/closed/);
});
test('non-coach account cannot load coach endpoints', async t => {
  const f=fixture();t.after(f.dispose);await settle();f.calls.length=0;
  const rejected = createController({current:{...f.app,user:{user_id:'regular',roles:['user']}}},()=>{}, {storage:f.storage,request:async()=>{throw new Error('must not request');},uiService:{toast(){}}});
  t.after(rejected.dispose);rejected.page.onLoad();assert.equal(rejected.page._loaded,false);
});
test('health-advice tool preserves long synchronous timeout and target customer', async t => {
  const f=fixture({response:u=>u==='/health-advice'?{statusCode:200,data:{success:true,message:'Fixture reply'}}:null});t.after(f.dispose);await settle();
  f.page.openClientDetail(event({client:managed}));
  f.page.handleChatToolAction({detail:{action:'health_advice'}});await settle();
  const c=f.calls.find(c=>c.url==='/health-advice');assert.equal(c.data.openid,managed.user_id);assert.equal(c.opts.timeoutMs,290000);assert.equal(c.data.async,false);
});
