'use strict';

// Adapter registry — add a new lab by creating a file here and adding one line below.
// Every adapter must export: validateWebhook, fetchOrder, fetchNewResults, parseResponse

const adapters = {
    generic: require('./generic'),
};

function getAdapter(labName) {
    const adapter = adapters[labName];
    if (!adapter) throw new Error(`No adapter registered for lab: ${labName}`);
    return adapter;
}

module.exports = { getAdapter };
