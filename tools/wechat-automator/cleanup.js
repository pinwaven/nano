// Force-kills WeChat DevTools + the embedded simulator. Reach for this when
// launch()/connect() hangs or errors with a port-in-use/timeout — usually a
// zombie process from a prior automation session that a plain `cli quit`
// didn't fully reap. Run with:
//   node cleanup.js
'use strict';

const { killStaleProcesses, quitProject } = require('./connect');

quitProject();
killStaleProcesses();
console.log('Killed any wechatwebdevtools / WeChatAppEx processes.');
