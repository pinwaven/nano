// Admin-panel Kino registration/edit/list contract, pinned against the machine API.
// The admin panel was split into per-tab files after this test was written: KinoModal and the
// list live in tabs/KinoTab.jsx, the URL builder and page limit in shared.jsx, the strings in
// translations.js, and only the initial fetch is still in App.jsx.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SRC = path.join(__dirname, '..', 'src', 'web', 'admin-panel', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const kinoTab = read('tabs', 'KinoTab.jsx');
const shared = read('shared.jsx');
const translations = read('translations.js');
const app = read('App.jsx');

function kinoModalSource() {
  const modalStart = kinoTab.indexOf('function KinoModal');
  const modalEnd = kinoTab.indexOf('function DeleteDeviceConfirm');
  assert.ok(modalStart > -1 && modalEnd > modalStart, 'KinoModal source should be found in tabs/KinoTab.jsx');
  return kinoTab.slice(modalStart, modalEnd);
}

test('admin Kino registration uses the machine batch API contract', () => {
  const modalSource = kinoModalSource();

  assert.match(modalSource, /axios\.post\('\/kino\/kino-machines\/batch',\s*\{\s*model:\s*form\.model,\s*quantity:\s*parseInt\(form\.quantity,\s*10\)/s);
  assert.match(kinoTab, /const EMPTY_DEVICE = \{ model: 'KNA1', quantity: 1/);
  assert.match(modalSource, /<option value="KNA1">KNA1<\/option>/);
  assert.match(modalSource, /<option value="KNA2">KNA2<\/option>/);
  assert.doesNotMatch(modalSource, /axios\.post\('\/api\/kino-devices'/);
});

test('admin Kino edit uses machine number based update API contract', () => {
  const modalSource = kinoModalSource();

  assert.match(modalSource, /const machineNo = form\.serial_number\.trim\(\)\.toUpperCase\(\)/);
  assert.match(modalSource, /axios\.put\(`\/kino\/kino-machines\/\$\{machineNo\}`,\s*payload\)/);
  assert.doesNotMatch(modalSource, /axios\.put\(`\/api\/kino-devices\/\$\{device\.id\}`/);
});

test('admin Kino list uses the paginated machine API with search query support', () => {
  assert.match(shared, /const KINO_MACHINE_PAGE_LIMIT = 10/);
  assert.match(shared, /params\.set\('q',\s*q\.trim\(\)\)/);
  assert.match(app, /axios\.get\('\/kino\/kino-machines\?page=1&limit=10'\)/);
  assert.match(kinoTab, /axios\.get\(buildKinoMachinesUrl\(\{ page,\s*q:\s*searchQuery \}\)\)/);
  assert.match(kinoTab, /setPage\(p => Math\.max\(1,\s*p - 1\)\)/);
  assert.match(kinoTab, /setPage\(p => Math\.min\(totalPages,\s*p \+ 1\)\)/);
});

test('admin Kino list keeps local page state in sync with refreshed pagination', () => {
  assert.match(kinoTab, /if \(machinePagination\) \{\s*setPagination\(machinePagination\);\s*setPage\(Number\(machinePagination\.page \?\? 1\)\);\s*\}/s);
});

test('admin Kino inactive status is labeled as not activated', () => {
  assert.match(translations, /statusInactive: 'Not Activated'/);
  assert.match(translations, /statusInactive: '未激活'/);
});

test('admin Kino add action is labeled as adding devices', () => {
  assert.match(translations, /addDevice: 'Add Device'/);
  assert.match(translations, /addDevice: 'Add Kino Device'/);
  assert.match(translations, /addDevice: '添加设备'/);
  assert.match(translations, /addDevice: '添加 Kino 设备'/);
  assert.doesNotMatch(translations, /Register Device|Register Kino Device|注册设备|注册 Kino 设备/);
});
