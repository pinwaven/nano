'use strict';
const crypto = require('crypto');
const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');
const LAB_ORDER_EVENT_SOURCE = 'acs.lab' + (process.env.EVENT_SOURCE_SUFFIX || '');
async function publishLabOrderImport(orderId) {
    try {
        const client = new EventBridge.default(new OpenApi.Config({
            accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
            accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
            securityToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
            endpoint: `eventbridge.${process.env.FC_REGION}.aliyuncs.com`,
        }));
        const response = await client.putEvents([new EventBridge.CloudEvent({
            id: crypto.randomUUID(), source: LAB_ORDER_EVENT_SOURCE, specversion: '1.0',
            type: 'lab.order.import', subject: String(orderId), datacontenttype: 'application/json',
            data: Buffer.from(JSON.stringify({ order_id: String(orderId) })), time: new Date().toISOString(),
            extensions: { aliyuneventbusname: 'default' },
        })]);
        if (response?.failedEntryCount > 0) throw new Error('EventBridge rejected lab import event');
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'Lab order publish failed', data: { order_id: String(orderId), error: err.message } }));
        throw err;
    }
}
module.exports = { publishLabOrderImport, LAB_ORDER_EVENT_SOURCE };
