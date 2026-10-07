'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const W = path.resolve(__dirname,'../src/functions/worker');
const { normalizeOrder, labDate } = require(W+'/lib/lab-order-normalize');
const catalog = [
    { key_name:'VitaminD',unit:'nmol/L',ref_low:50,ref_high:150 },
    { key_name:'HbA1c',unit:'%',ref_low:null,ref_high:5.7 },
    { key_name:'Hcy',unit:'umol/L',ref_low:null,ref_high:15 },
];
const order = () => ({ id:'53',user_id:'u1',language:'zh',lab_name:'qcs',external_order_id:'ext53',revision:'r1',
    report_pdf_key:'lab-reports/qcs/ext53/1049-hash.pdf',
    lab_final_result:{ goods:[{ id:1049,name:'维生素D',progress:'completed',reported_at:1785309516,
        bodyindex_panels:[{ name:'维生素D',test_time:1785305191,bodyindexes:[
            { id:'d2',name:'25-OH维生素D2',unit:'ng/mL',value:'OUT_OF_DEVICE_LOWER_RANGE' },
            { id:'d3',name:'25-OH维生素D3',unit:'ng/mL',value:38.91 },
            { id:'total',name:'25-OH维生素D',unit:'ng/mL',value:38.91 },
        ] }] }] } });
test('QCS total D converts to SI, fractions and detection limits remain raw', () => {
    const [g] = normalizeOrder(order(),catalog);
    assert.equal(g.date,'2026-07-29');
    assert.equal(g.rows[0].value_text,'OUT_OF_DEVICE_LOWER_RANGE');
    assert.equal(g.rows[0].observation,null);
    assert.equal(g.rows[1].observation,null);
    assert.equal(g.rows[2].observation.value,97.119);
    assert.equal(g.rows[2].observation.unit,'nmol/L');
    assert.equal(g.rows[2].value_num,38.91); // raw result retained separately
});
test('dates use Shanghai day and never fabricate today', () => {
    assert.equal(labDate(Date.parse('2026-07-28T17:00:00Z')/1000),'2026-07-29');
    assert.equal(labDate(null),null);
    const o=order();delete o.lab_final_result.goods[0].reported_at;delete o.lab_final_result.goods[0].bodyindex_panels[0].test_time;
    const [g]=normalizeOrder(o,catalog);assert.equal(g.date,null);assert.equal(g.rows[2].observation,null);
});
test('wrong units and implausible values are retained but cannot feed the twin', () => {
    for (const edit of [{unit:'mg/L'},{value:99999},{unit:null},{value:'<0.1'}]) {
        const o=order();Object.assign(o.lab_final_result.goods[0].bodyindex_panels[0].bodyindexes[2],edit);
        assert.equal(normalizeOrder(o,catalog)[0].rows[2].observation,null);
    }
});
test('only completed goods import, with stable unique goods identities', () => {
    const o=order();o.lab_final_result.goods.push({id:2,progress:'processing'});
    assert.equal(normalizeOrder(o,catalog).length,1);
    o.lab_final_result.goods.push(o.lab_final_result.goods[0]);assert.throws(()=>normalizeOrder(o,catalog),/duplicate/);
});
// Factory injection keeps tests offline, including the EventBridge and twin dependencies.
for (const [relative,exports] of Object.entries({
    'lib/db.js':{pool:null}, 'lib/lab-order-events.js':{publishLabOrderImport:async()=>{}},
    'lib/healthTwinUpdater.js':{updateHealthTwin:async()=>{}},
})) { const filename=require.resolve(W+'/'+relative); require.cache[filename]={id:filename,filename,loaded:true,exports}; }
const { createImporter } = require(W+'/lib/lab-order-import');
function harness({ failRefresh=false, failPublish=false }={}) {
    const calls=[];let state=null;const o=order();let published=0,refreshed=0;
    const query=async(sql,p=[])=>{
        calls.push({sql,p});
        if (/FROM lab_orders l JOIN users/.test(sql)) return {rows:[o]};
        if (/SELECT \* FROM lab_order_imports/.test(sql)) return {rows:state?[state]:[]};
        if (/SELECT 1 FROM health_reports/.test(sql) || /SELECT id,lab_goods_id/.test(sql)) return {rows:[]};
        if (/SELECT \* FROM biomarker_catalog/.test(sql)) return {rows:catalog};
        if (/INSERT INTO lab_order_imports/.test(sql)) { state={revision:o.revision,status:/processing/.test(sql)?'processing':/failed/.test(sql)?'failed':'queued'};return {rows:[]}; }
        if (/UPDATE lab_order_imports SET/.test(sql)) { state={revision:o.revision,status:p[1],counts:JSON.parse(p[2])};return {rows:[]}; }
        if (/INSERT INTO health_documents/.test(sql)) return {rows:[{id:5,status:'active'}]};
        if (/INSERT INTO health_reports/.test(sql)) return {rows:[{id:9}]};
        return {rows:[],rowCount:1};
    };
    const db={query,connect:async()=>({query,release:()=>calls.push({sql:'release'})})};
    return {calls,o,get state(){return state;},get published(){return published;},get refreshed(){return refreshed;},
        importer:createImporter({db,publish:async()=>{published++;if(failPublish)throw new Error('publish failed');},
            refresh:async(user,client,opts)=>{refreshed++;assert.equal(user,'u1');assert.equal(opts.throwOnError,true);if(failRefresh)throw new Error('refresh failed');}})};
}
test('import writes raw items, only validated events, a viewable PDF and twin in one transaction',async()=>{
    const h=harness();const r=await h.importer.run('53');
    assert.equal(r.counts.items,3);assert.equal(r.counts.observations,1);assert.equal(r.counts.documents,1);
    const events=h.calls.filter(c=>/INSERT INTO health_events/.test(c.sql));assert.equal(events.length,1);
    assert.equal(JSON.parse(events[0].p[2]).value,97.119);
    assert.equal(h.calls.at(-2).sql,'COMMIT');assert.equal(h.refreshed,1);
    await h.importer.run('53');assert.equal(h.refreshed,1); // replay is a no-op
    h.o.revision='r2';h.o.lab_final_result.goods[0].bodyindex_panels[0].bodyindexes[2].value=30;
    await h.importer.run('53');assert.equal(h.refreshed,2);
    const replacement=h.calls.filter(c=>/INSERT INTO health_events/.test(c.sql)).at(-1);
    assert.equal(JSON.parse(replacement.p[2]).value,74.88);
    assert.equal(replacement.p[4],events[0].p[4]); // correction retains its external identity
});
test('twin failure rolls back the import and records a recoverable failure',async()=>{
    const h=harness({failRefresh:true});await assert.rejects(h.importer.run('53'),/refresh failed/);
    assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
    assert.equal(h.state.status,'failed');
});
test('queue persists before publish; failed publish is retryable and inputs are checked',async()=>{
    const h=harness({failPublish:true});assert.equal((await h.importer.queue('53')).statusCode,503);
    assert.equal(h.state.status,'queued');assert.ok(h.calls.some(c=>c.sql==='COMMIT'));
    assert.equal((await h.importer.queue('0')).statusCode,400);
    h.o.lab_name='other';assert.equal((await h.importer.queue('53')).statusCode,422);
});
test('PDF-only results queue extraction, without inventing measurements',async()=>{
    const h=harness();h.o.lab_final_result.goods[0].bodyindex_panels=[];
    const r=await h.importer.run('53');assert.equal(r.counts.observations,0);assert.equal(r.counts.extractions_queued,1);
    assert.equal(r.status,'waiting');assert.ok(h.calls.some(c=>/INSERT INTO doc_extraction_jobs/.test(c.sql)));
});
test('a foreign PDF key fails before importing',async()=>{
    const h=harness();h.o.report_pdf_key='lab-reports/qcs/other/1049-hash.pdf';
    await assert.rejects(h.importer.run('53'),/Invalid QCS PDF key/);
});
