'use strict';

/**
 * WeChat Pay adapter.
 *
 * WeChat Pay and WeCom Pay both use the WeChat Pay API v3 protocol. The WeCom
 * adapter already contains the protocol implementation, so this adapter wraps
 * it with WeChat-specific defaults and provider identity. Keeping a separate
 * file makes registry/configuration explicit and leaves room for WeChat-only
 * behavior later without changing callers.
 */

const wecom = require('./wecom');

function withWechatDefaults(providerRow = {}) {
    // Kept as a wrapper so WeChat can diverge from WeCom later. Credentials
    // still come from `payment_providers.config`; no env fallback is used.
    return { ...providerRow };
}

async function createPayment(input, providerRow) {
    return wecom.createPayment(input, withWechatDefaults(providerRow));
}

async function queryPayment(input, providerRow) {
    return wecom.queryPayment(input, withWechatDefaults(providerRow));
}

async function closePayment(input, providerRow) {
    return wecom.closePayment(input, withWechatDefaults(providerRow));
}

async function createRefund(input, providerRow) {
    return wecom.createRefund(input, withWechatDefaults(providerRow));
}

async function queryRefund(input, providerRow) {
    return wecom.queryRefund(input, withWechatDefaults(providerRow));
}

async function verifyPaymentCallback(input, providerRow) {
    return wecom.verifyPaymentCallback(input, withWechatDefaults(providerRow));
}

async function verifyRefundCallback(input, providerRow) {
    return wecom.verifyRefundCallback(input, withWechatDefaults(providerRow));
}

function paymentCallbackResponse() {
    return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>';
}

function refundCallbackResponse() {
    return '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>';
}

function validateConfig(providerRow) {
    return wecom.validateConfig(withWechatDefaults(providerRow));
}

module.exports = {
    provider: 'wechat',
    createPayment,
    queryPayment,
    closePayment,
    createRefund,
    queryRefund,
    verifyPaymentCallback,
    verifyRefundCallback,
    paymentCallbackResponse,
    refundCallbackResponse,
    validateConfig,
    __private: {
        withWechatDefaults,
        base: wecom,
    },
};
