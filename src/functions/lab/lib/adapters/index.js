'use strict';

// Adapter registry. Add a new lab by creating a sibling adapter file and adding
// one entry below. generic.js is the reference contract for method signatures.
//
// Every adapter must export:
//   validateWebhook, fetchOrder, fetchNewResults, parseResponse
//
// Adapters used by POST /lab/order must also export:
//   createOrder/create_order and cancelOrder/cancel_order
//
// Critical invariant: once a vendor primary order exists, createOrder must
// return external_order_id for lab_orders persistence. If later vendor steps
// fail, mark lab_last_result.needs_cancel=true so poll can compensate.

const adapters = {
    generic: require('./generic'),
    qcs: require('./qcs'),
};

function getAdapter(labName) {
    const adapter = adapters[labName];
    if (!adapter) throw new Error(`No adapter registered for lab: ${labName}`);
    return adapter;
}

module.exports = { getAdapter };
