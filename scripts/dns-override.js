'use strict';
// Redirects this Node process's DNS lookups through 8.8.8.8 instead of the OS resolver.
// Scoped entirely to the process it's --require'd into via NODE_OPTIONS — no system/network
// settings are touched, nothing persists after the command exits.
//
// Ported from the sibling repo (/Users/pin/waven/gcn/scripts/dns-override.js), which hit and
// fixed the identical class of issue for its own Aliyun FC deploys.
//
// Use when `s <fn> deploy` fails with `getaddrinfo ENOTFOUND resourcemanager.aliyuncs.com` (or
// another *.aliyuncs.com host Serverless Devs resolves during deploy) — confirmed 2026-08-08:
// the system resolver returned nothing for resourcemanager.aliyuncs.com while `nslookup
// resourcemanager.aliyuncs.com 8.8.8.8` resolved it fine.
//
//   source .env && NODE_OPTIONS="--require ./scripts/dns-override.js" s worker deploy -t s-prod.yaml -y
const dns = require('dns');
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8']);

const originalLookup = dns.lookup.bind(dns);

dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const wantsAll = options && options.all === true;

  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      return originalLookup(hostname, options, callback);
    }
    if (wantsAll) {
      return callback(null, addresses.map(address => ({ address, family: 4 })));
    }
    callback(null, addresses[0], 4);
  });
};
