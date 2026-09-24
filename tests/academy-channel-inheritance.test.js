const test = require('node:test');
const assert = require('node:assert/strict');
const db = require.resolve('../src/functions/worker/lib/db');
const auth = require.resolve('../src/functions/worker/lib/auth');
let calls = [], visible = [];
require.cache[db] = { id: db, filename: db, loaded: true, exports: { pool: { query: async (sql, params) => {
    calls.push({sql, params});
    if (sql.includes('academy_course_visible')) return {rows: visible};
    if (sql.includes('AS inherit_courses')) return {rows: [{inherit_courses: false}]};
    if (sql.includes('FROM academy_lessons')) return {rows: [{id: 10}]};
    return {rows: []};
} } } };
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {requirePermission: (ctx, p) => ctx.perms?.includes(p) ? null : {statusCode: 403}} };
const policy = require('../src/functions/worker/lib/academyVisibility');
const ctx = {role:'channel', channelId:7, perms:['academy:read','academy:write']};
test.beforeEach(()=>{calls=[];visible=[]});
test('settings only update the authenticated channel and reject non-booleans', async()=>{
 assert.equal((await policy.settings(ctx,{inherit_courses:'false'})).statusCode,400);
 assert.equal(calls.length,0);
 await policy.settings(ctx,{inherit_courses:false,channel_id:2});
 assert.deepEqual(calls[0].params,[false,7]);
});
test('settings require Academy write permission',async()=>{
 assert.equal((await policy.settings({...ctx,perms:['academy:read']},{inherit_courses:false})).statusCode,403);
 assert.equal(calls.length,0);
});
test('catalog uses session channel and learner for enrollment exception',async()=>{
 visible=[{id:2}];
 assert.deepEqual(await policy.filterCourses([{id:1},{id:2}],{role:'user',user:{channel_id:7,user_id:'learner'}}),[{id:2}]);
 assert.deepEqual(calls[0].params,[7,'learner']);
});
test('hidden lesson direct URL and progress write are refused',async()=>{
 assert.equal((await policy.authorize(ctx,'GET','/academy/lessons/3',{},{})).statusCode,403);
 assert.equal((await policy.authorize(ctx,'POST','/academy/progress',{}, {lesson_id:3})).statusCode,403);
});
test('enrolled learner can continue a visible lesson',async()=>{
 visible=[{id:10}];
 assert.equal(await policy.authorize({role:'user',user:{channel_id:7,user_id:'learner'}},'GET','/academy/lessons/3',{},{}),null);
});
test('superadmin catalog is not filtered',async()=>{
 assert.deepEqual(await policy.filterCourses([{id:1}],{role:'superadmin'}),[{id:1}]); assert.equal(calls.length,0);
});
