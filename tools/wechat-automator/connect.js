// Reusable miniprogram-automator connect/launch helper for nano-miniapp.
// See README.md for usage and the gotchas this encodes.
'use strict';

const path = require('path');
const { execSync } = require('child_process');
const automator = require('miniprogram-automator');

const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT_PATH = path.resolve(__dirname, '../../src/mini/nano-miniapp');
const DEFAULT_PORT = 22090;

function killStaleProcesses() {
  for (const pattern of ['wechatwebdevtools', 'WeChatAppEx']) {
    try { execSync(`pkill -9 -f "${pattern}"`, { stdio: 'ignore' }); } catch (e) { /* nothing to kill */ }
  }
}

function quitProject() {
  try { execSync(`"${CLI_PATH}" quit --project "${PROJECT_PATH}"`, { stdio: 'ignore' }); } catch (e) { /* not open */ }
}

// Full cold-start recovery: quit the project window, force-kill any zombie
// DevTools/simulator processes, then wait for ports to actually free up.
// Use when launch()/connect() hangs or errors with a port-in-use/timeout.
async function coldStart() {
  quitProject();
  killStaleProcesses();
  await new Promise((r) => setTimeout(r, 2000));
}

// Opens the project (if needed), enables automation, and connects — one call.
// Prefer this over manually shelling out to `cli auto` + automator.connect():
// running `cli auto` against an already-open, stale project window can hang
// with `routeTo appLaunch timeout` in the IDE's WeappLog. automator.launch()
// does open+auto+connect and is the reliable path from a cold start.
async function launch({ port = DEFAULT_PORT, freshStart = false } = {}) {
  if (freshStart) await coldStart();
  return automator.launch({ cliPath: CLI_PATH, projectPath: PROJECT_PATH, port });
}

// Attaches to an already-running `cli auto`/automator.launch() instance on
// the given port. Fails fast if nothing is listening there.
async function connect(port = DEFAULT_PORT) {
  return automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
}

module.exports = { launch, connect, coldStart, killStaleProcesses, quitProject, CLI_PATH, PROJECT_PATH, DEFAULT_PORT };
