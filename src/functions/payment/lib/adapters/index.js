'use strict';

const adapters = {
    wecom: require('./wecom'),
    wechat: require('./wechat'),
    alipay: require('./alipay'),
};

function getAdapter(provider) {
    const adapter = adapters[provider];
    if (!adapter) throw new Error(`No payment adapter registered for provider: ${provider}`);
    return adapter;
}

module.exports = { getAdapter };
