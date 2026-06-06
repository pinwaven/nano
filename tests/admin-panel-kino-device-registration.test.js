const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appPath = path.join(__dirname, '..', 'src', 'web', 'admin-panel', 'src', 'App.jsx');

test('admin Kino registration uses the machine batch API contract', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  const modalStart = source.indexOf('function KinoModal');
  const modalEnd = source.indexOf('function DeleteDeviceConfirm');
  assert.ok(modalStart > -1 && modalEnd > modalStart, 'KinoModal source should be found');

  const modalSource = source.slice(modalStart, modalEnd);

  assert.match(modalSource, /const quantity = parseInt\(form\.quantity,\s*10\)/);
  assert.match(modalSource, /axios\.post\('\/kino\/kino-machines\/batch',\s*\{\s*model:\s*form\.model,\s*quantity/s);
  assert.match(source, /const EMPTY_DEVICE = \{ model: 'KNA1', quantity: 1/);
  assert.match(modalSource, /<option value="KNA1">KNA1<\/option>/);
  assert.match(modalSource, /<option value="KNA2">KNA2<\/option>/);
  assert.doesNotMatch(modalSource, /axios\.post\('\/api\/kino-devices'/);
});

test('admin Kino edit uses machine number based update API contract', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  const modalStart = source.indexOf('function KinoModal');
  const modalEnd = source.indexOf('function DeleteDeviceConfirm');
  assert.ok(modalStart > -1 && modalEnd > modalStart, 'KinoModal source should be found');

  const modalSource = source.slice(modalStart, modalEnd);

  assert.match(modalSource, /const machineNo = form\.serial_number\.trim\(\)\.toUpperCase\(\)/);
  assert.match(modalSource, /axios\.put\(`\/kino\/kino-machines\/\$\{machineNo\}`,\s*payload\)/);
  assert.doesNotMatch(modalSource, /axios\.put\(`\/api\/kino-devices\/\$\{device\.id\}`/);
});

test('admin Kino list uses the paginated machine API with search query support', () => {
  const source = fs.readFileSync(appPath, 'utf8');

  assert.match(source, /const KINO_MACHINE_PAGE_LIMIT = 10/);
  assert.match(source, /axios\.get\('\/kino\/kino-machines\?page=1&limit=10'\)/);
  assert.match(source, /params\.set\('q',\s*q\.trim\(\)\)/);
  assert.match(source, /axios\.get\(buildKinoMachinesUrl\(\{ page,\s*q:\s*searchQuery \}\)\)/);
  assert.match(source, /setPage\(p => Math\.max\(1,\s*p - 1\)\)/);
  assert.match(source, /setPage\(p => Math\.min\(totalPages,\s*p \+ 1\)\)/);
});

test('admin Kino list keeps local page state in sync with refreshed pagination', () => {
  const source = fs.readFileSync(appPath, 'utf8');

  assert.match(source, /if \(machinePagination\) \{\s*setPagination\(machinePagination\);\s*setPage\(Number\(machinePagination\.page \?\? 1\)\);\s*\}/s);
});

test('admin Kino inactive status is labeled as not activated', () => {
  const source = fs.readFileSync(appPath, 'utf8');

  assert.match(source, /statusInactive: 'Not Activated'/);
  assert.match(source, /statusInactive: '未激活'/);
});

test('admin Kino add action is labeled as adding devices', () => {
  const source = fs.readFileSync(appPath, 'utf8');

  assert.match(source, /addDevice: 'Add Device'/);
  assert.match(source, /addDevice: 'Add Kino Device'/);
  assert.match(source, /addDevice: '添加设备'/);
  assert.match(source, /addDevice: '添加 Kino 设备'/);
  assert.doesNotMatch(source, /Register Device|Register Kino Device|注册设备|注册 Kino 设备/);
});
