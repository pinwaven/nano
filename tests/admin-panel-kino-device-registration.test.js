const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The admin panel's Kino UI was split out of App.jsx into per-tab/shared modules.
// KinoModal + the machine list live in tabs/KinoTab.jsx, pagination helpers in
// shared.jsx, the initial machines fetch in App.jsx, and i18n strings in translations.js.
const srcDir = path.join(__dirname, '..', 'src', 'web', 'admin-panel', 'src');
const read = (...p) => fs.readFileSync(path.join(srcDir, ...p), 'utf8');

const kinoTabSource    = read('tabs', 'KinoTab.jsx');
const sharedSource     = read('shared.jsx');
const appSource        = read('App.jsx');
const translationsSource = read('translations.js');

// Whole-source matches may live in any of the split modules.
const allSource = [kinoTabSource, sharedSource, appSource, translationsSource].join('\n');

// The KinoModal component (registration + edit) lives in KinoTab.jsx.
const modalStart = kinoTabSource.indexOf('function KinoModal');
const modalEnd = kinoTabSource.indexOf('function DeleteDeviceConfirm');
const modalSource = kinoTabSource.slice(modalStart, modalEnd);

test('admin Kino registration uses the machine batch API contract', () => {
  assert.ok(modalStart > -1 && modalEnd > modalStart, 'KinoModal source should be found');

  assert.match(modalSource, /const quantity = parseInt\(form\.quantity,\s*10\)/);
  assert.match(modalSource, /axios\.post\('\/kino\/kino-machines\/batch',\s*\{\s*model:\s*form\.model,\s*quantity/s);
  assert.match(kinoTabSource, /const EMPTY_DEVICE = \{ model: 'KNA1', quantity: 1/);
  assert.match(modalSource, /<option value="KNA1">KNA1<\/option>/);
  assert.match(modalSource, /<option value="KNA2">KNA2<\/option>/);
  assert.doesNotMatch(modalSource, /axios\.post\('\/api\/kino-devices'/);
});

test('admin Kino edit uses machine number based update API contract', () => {
  assert.ok(modalStart > -1 && modalEnd > modalStart, 'KinoModal source should be found');

  assert.match(modalSource, /const machineNo = form\.serial_number\.trim\(\)\.toUpperCase\(\)/);
  assert.match(modalSource, /axios\.put\(`\/kino\/kino-machines\/\$\{machineNo\}`,\s*payload\)/);
  assert.doesNotMatch(modalSource, /axios\.put\(`\/api\/kino-devices\/\$\{device\.id\}`/);
});

test('admin Kino list uses the paginated machine API with search query support', () => {
  assert.match(allSource, /const KINO_MACHINE_PAGE_LIMIT = 10/);
  assert.match(allSource, /axios\.get\('\/kino\/kino-machines\?page=1&limit=10'\)/);
  assert.match(allSource, /params\.set\('q',\s*q\.trim\(\)\)/);
  assert.match(allSource, /axios\.get\(buildKinoMachinesUrl\(\{ page,\s*q:\s*searchQuery \}\)\)/);
  assert.match(allSource, /setPage\(p => Math\.max\(1,\s*p - 1\)\)/);
  assert.match(allSource, /setPage\(p => Math\.min\(totalPages,\s*p \+ 1\)\)/);
});

test('admin Kino list keeps local page state in sync with refreshed pagination', () => {
  assert.match(allSource, /if \(machinePagination\) \{\s*setPagination\(machinePagination\);\s*setPage\(Number\(machinePagination\.page \?\? 1\)\);\s*\}/s);
});

test('admin Kino inactive status is labeled as not activated', () => {
  assert.match(translationsSource, /statusInactive: 'Not Activated'/);
  assert.match(translationsSource, /statusInactive: '未激活'/);
});

test('admin Kino add action is labeled as adding devices', () => {
  assert.match(translationsSource, /addDevice: 'Add Device'/);
  assert.match(translationsSource, /addDevice: 'Add Kino Device'/);
  assert.match(translationsSource, /addDevice: '添加设备'/);
  assert.match(translationsSource, /addDevice: '添加 Kino 设备'/);
  assert.doesNotMatch(translationsSource, /Register Device|Register Kino Device|注册设备|注册 Kino 设备/);
});
