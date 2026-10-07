'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const W=path.resolve(__dirname,'../src/functions/worker');
let sent, response={failedEntryCount:0};
for(const [name,exports] of Object.entries({
    '@alicloud/eventbridge':{default:class{async putEvents(events){sent=events;return response;}},CloudEvent:class{constructor(value){Object.assign(this,value);}}},
    '@alicloud/openapi-client':{Config:class{constructor(value){Object.assign(this,value);}}},
})) {const filename=require.resolve(name,{paths:[W]});require.cache[filename]={id:filename,filename,loaded:true,exports};}
process.env.EVENT_SOURCE_SUFFIX='.dev';
const {publishLabOrderImport}=require(W+'/lib/lab-order-events');
delete process.env.EVENT_SOURCE_SUFFIX;
test('publisher emits environment-scoped CloudEvents containing only the order ID',async()=>{
    await publishLabOrderImport('53');const [event]=sent;
    assert.equal(event.specversion,'1.0');assert.equal(event.source,'acs.lab.dev');assert.equal(event.type,'lab.order.import');
    assert.equal(event.datacontenttype,'application/json');assert.deepEqual(JSON.parse(event.data.toString()),{order_id:'53'});
    assert.ok(event.id);assert.ok(event.time);
});
test('EventBridge per-entry rejection fails the publish instead of returning an acknowledgement',async()=>{
    response={failedEntryCount:1};await assert.rejects(publishLabOrderImport('53'),/rejected/);
});

test('deployment keeps private credentials and event consumers separate between dev and prod',()=>{
    const fs=require('node:fs');
    const dev=fs.readFileSync(path.resolve(W,'../../../s.yaml'),'utf8');
    const prod=fs.readFileSync(path.resolve(W,'../../../s-prod.yaml'),'utf8');
    assert.ok(dev.includes('LAB_IMPORT_TOKEN: ${env(LAB_IMPORT_TOKEN)}'));
    assert.ok(prod.includes('LAB_IMPORT_TOKEN: ${env(LAB_IMPORT_TOKEN_PROD)}'));
    assert.ok(dev.includes('"acs.lab.dev"'));assert.ok(prod.includes('"acs.lab"'));
    for(const config of [dev,prod]) assert.ok(config.includes('triggerName: lab-order-reconcile'));
});
