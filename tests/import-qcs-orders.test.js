const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

function baseDeps(overrides = {}) {
  const inserted = [];
  const updated = [];
  const pdfStored = [];
  const pdfKeys = [];
  const deps = {
    config: { api_base_url: 'https://qcs.example/third-party' },
    labName: 'qcs',
    async listOrders() { return [{ id: 'QCS-1' }]; },
    async fetchOrder(id) { return { id, progress: 'complete', member: { mobile: '13800000001' } }; },
    phoneFromOrder(detail) { return detail.member.mobile; },
    async matchUser() { return 'user-1'; },
    async findLabOrder() { return null; },
    async insertLabOrder(order) { inserted.push(order); return { id: inserted.length, ...order }; },
    async updateLabOrder(row, detail) { updated.push({ row, detail }); return { id: row.id }; },
    // Required by the failing test 'updates an existing lab_order whose stored
    // status no longer matches the lab': runImport calls orderStatus(detail) to
    // detect drift. Without it the call throws TypeError, runImport's per-order
    // catch swallows it, and ordersUpdated/pdfUploaded stay 0 — which is the
    // "0 !== 1" both red tests report. Mirrors qcs.qcsProgressToLabStatus.
    orderStatus(detail) { return detail.progress === 'complete' ? '已完成' : '处理中'; },
    isOrderComplete(detail) { return detail.progress === 'complete'; },
    async storeReportPdf(order) {
      pdfStored.push(order.id);
      return `lab-reports/qcs/${order.id}/1-deadbeef.pdf`;
    },
    async setLabOrderPdfKey(rowId, key) { pdfKeys.push({ rowId, key }); },
    log() {},
    _inserted: inserted,
    _pdfStored: pdfStored,
    _pdfKeys: pdfKeys,
  };
  return { ...deps, ...overrides };
}

describe('import-qcs-orders runImport', () => {
  test('inserts lab_order only and uploads report pdf for a matched complete order', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps();

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.ordersInserted, 1);
    assert.equal(summary.pdfUploaded, 1);
    assert.equal(summary.errors, 0);
    assert.equal(summary.reportsInserted, undefined);
    assert.equal(deps._inserted.length, 1);
    assert.equal(deps._inserted[0].lab_name, 'qcs');
    assert.equal(deps._inserted[0].user_id, 'user-1');
    assert.equal(deps._inserted[0].external_order_id, 'QCS-1');
    assert.deepEqual(deps._pdfKeys, [{ rowId: 1, key: 'lab-reports/qcs/QCS-1/1-deadbeef.pdf' }]);
  });

  test('skips orders whose phone matches no user and does not insert', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ async matchUser() { return null; } });

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 0);
    assert.equal(summary.skippedNoUser, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._pdfStored, []);
  });

  test('inserts but does not fetch pdf for incomplete orders', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async fetchOrder(id) { return { id, progress: 'processing', member: { mobile: '13800000001' } }; },
    });

    const summary = await runImport(deps);

    assert.equal(summary.ordersInserted, 1);
    assert.equal(summary.pdfUploaded, 0);
    assert.equal(summary.errors, 0);
    assert.deepEqual(deps._pdfStored, []);
    assert.deepEqual(deps._pdfKeys, []);
  });

  test('skips orders already present in lab_orders (dedup on re-run)', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async findLabOrder() { return { id: 7, report_pdf_key: 'lab-reports/qcs/QCS-1/1-old.pdf' }; },
    });

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._pdfStored, []);
    assert.deepEqual(deps._pdfKeys, []);
  });

  test('updates an existing lab_order whose stored status no longer matches the lab', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const updated = [];
    const deps = baseDeps({
      async findLabOrder() { return { id: 7, report_pdf_key: 'lab-reports/qcs/QCS-1/1-old.pdf', status: '处理中' }; },
      // The whole row is passed through: the real updateLabOrder keys its
      // WHERE on id AND external_order_id.
      async updateLabOrder(row, detail) { updated.push({ row, detail }); return { id: row.id }; },
    });

    const summary = await runImport(deps);

    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.ordersUpdated, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].row.id, 7);
    assert.equal(updated[0].detail.id, 'QCS-1');
  });

  test('backfills pdf onto duplicate rows missing report_pdf_key', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ async findLabOrder() { return { id: 7, report_pdf_key: null }; } });

    const summary = await runImport(deps);

    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(summary.pdfUploaded, 1);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._pdfKeys, [{ rowId: 7, key: 'lab-reports/qcs/QCS-1/1-deadbeef.pdf' }]);
  });

  test('does not backfill duplicates whose order is still incomplete', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async fetchOrder(id) { return { id, progress: 'processing', member: { mobile: '13800000001' } }; },
      async findLabOrder() { return { id: 7, report_pdf_key: null }; },
    });

    const summary = await runImport(deps);

    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.pdfUploaded, 0);
    assert.deepEqual(deps._pdfStored, []);
    assert.deepEqual(deps._pdfKeys, []);
  });

  test('dry-run matches but performs no inserts or uploads', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ dryRun: true });

    const summary = await runImport(deps);

    assert.equal(summary.matched, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(summary.skippedDuplicate, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._pdfStored, []);
  });

  test('pdf failure counts pdfErrors but never blocks the order insert', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async storeReportPdf() { throw new Error('oss down'); },
    });

    const summary = await runImport(deps);

    assert.equal(summary.ordersInserted, 1);
    assert.equal(summary.pdfErrors, 1);
    assert.equal(summary.pdfUploaded, 0);
    assert.equal(summary.errors, 0);
    assert.deepEqual(deps._pdfKeys, []);
  });

  test('skips pdf update when storeReportPdf finds no report', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ async storeReportPdf() { return null; } });

    const summary = await runImport(deps);

    assert.equal(summary.ordersInserted, 1);
    assert.equal(summary.pdfUploaded, 0);
    assert.equal(summary.pdfErrors, 0);
    assert.deepEqual(deps._pdfKeys, []);
  });

  test('reports per-order progress with position, total and outcome', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const events = [];
    let matchCalls = 0;
    const deps = baseDeps({
      async listOrders() { return [{ id: 'QCS-1' }, { id: 'QCS-2' }]; },
      async matchUser() { matchCalls += 1; return matchCalls === 1 ? 'user-1' : null; },
      onProgress(event) { events.push(event); },
    });

    await runImport(deps);

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { index: 1, total: 2, orderId: 'QCS-1', outcome: 'inserted' });
    assert.deepEqual(events[1], { index: 2, total: 2, orderId: 'QCS-2', outcome: 'no-user' });
  });

  test('records an error and continues when one order fails', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async listOrders() { return [{ id: 'BAD' }, { id: 'QCS-2' }]; },
      async fetchOrder(id) {
        if (id === 'BAD') throw new Error('boom');
        return { id, progress: 'complete', member: { mobile: '13800000002' } };
      },
    });

    const summary = await runImport(deps);

    assert.equal(summary.total, 2);
    assert.equal(summary.errors, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.ordersInserted, 1);
    assert.equal(deps._inserted.length, 1);
    assert.equal(deps._inserted[0].external_order_id, 'QCS-2');
  });
});

function pdfDeps(overrides = {}) {
  const uploads = [];
  const warns = [];
  const deps = {
    qcs: {
      completedGoods(detail) {
        return (detail.goods || []).filter((g) => g.progress === 'completed');
      },
      async fetchReportUrl() { return { url: 'https://files.qcs/tmp.pdf', size: 8 }; },
    },
    async httpGet() { return Buffer.from('%PDF-1.4'); },
    async putBuffer(key, buffer, options) { uploads.push({ key, buffer, options }); return key; },
    randomHex() { return 'cafebabe'; },
    labName: 'qcs',
    config: { api_base_url: 'https://qcs.example/third-party' },
    warn(msg) { warns.push(msg); },
    _uploads: uploads,
    _warns: warns,
  };
  return { ...deps, ...overrides };
}

describe('import-qcs-orders makeStoreReportPdf', () => {
  test('returns null without fetching when the order has no completed goods', async () => {
    const { makeStoreReportPdf } = require('../scripts/import-qcs-orders');
    const deps = pdfDeps();
    const storeReportPdf = makeStoreReportPdf(deps);

    const key = await storeReportPdf(
      { id: 'QCS-1' },
      { goods: [{ id: 1, progress: 'no_process' }] }
    );

    assert.equal(key, null);
    assert.deepEqual(deps._uploads, []);
  });

  test('downloads the report and uploads it private under a random-suffixed key', async () => {
    const { makeStoreReportPdf } = require('../scripts/import-qcs-orders');
    const fetched = [];
    const deps = pdfDeps({
      qcs: {
        completedGoods(detail) {
          return (detail.goods || []).filter((g) => g.progress === 'completed');
        },
        async fetchReportUrl(args) { fetched.push(args); return { url: 'https://files.qcs/tmp.pdf', size: 8 }; },
      },
    });
    const storeReportPdf = makeStoreReportPdf(deps);

    const key = await storeReportPdf(
      { id: 'QCS-9' },
      { goods: [{ id: 42, progress: 'completed' }] }
    );

    assert.equal(key, 'lab-reports/qcs/QCS-9/42-cafebabe.pdf');
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].orderId, 'QCS-9');
    assert.equal(fetched[0].goodId, 42);
    assert.equal(deps._uploads.length, 1);
    assert.equal(deps._uploads[0].key, 'lab-reports/qcs/QCS-9/42-cafebabe.pdf');
    assert.deepEqual(deps._uploads[0].buffer, Buffer.from('%PDF-1.4'));
    // Lab report PDFs are PHI: they must land private. The bucket has Block
    // Public Access enabled, so requesting a public-read ACL is also rejected
    // outright by OSS ("Put public object acl is not allowed").
    assert.deepEqual(deps._uploads[0].options, { contentType: 'application/pdf' });
  });

  test('warns and stores only the first report when multiple goods completed', async () => {
    const { makeStoreReportPdf } = require('../scripts/import-qcs-orders');
    const deps = pdfDeps();
    const storeReportPdf = makeStoreReportPdf(deps);

    const key = await storeReportPdf(
      { id: 'QCS-9' },
      { goods: [{ id: 42, progress: 'completed' }, { id: 43, progress: 'completed' }] }
    );

    assert.equal(key, 'lab-reports/qcs/QCS-9/42-cafebabe.pdf');
    assert.equal(deps._uploads.length, 1);
    assert.equal(deps._warns.length, 1);
  });

  test('returns null without uploading when QCS returns no report url', async () => {
    const { makeStoreReportPdf } = require('../scripts/import-qcs-orders');
    const deps = pdfDeps({
      qcs: {
        completedGoods(detail) {
          return (detail.goods || []).filter((g) => g.progress === 'completed');
        },
        async fetchReportUrl() { return {}; },
      },
    });
    const storeReportPdf = makeStoreReportPdf(deps);

    const key = await storeReportPdf(
      { id: 'QCS-9' },
      { goods: [{ id: 42, progress: 'completed' }] }
    );

    assert.equal(key, null);
    assert.deepEqual(deps._uploads, []);
  });
});

function builderArgs(overrides = {}) {
  const queries = [];
  const args = {
    opts: { labName: 'qcs', dryRun: false, progress: '', ak: 'AK', as: 'AS' },
    config: { api_base_url: 'https://qcs.example/third-party' },
    qcs: require('../src/functions/lab/lib/adapters/qcs'),
    db: {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [{ id: 7, report_pdf_key: null }] };
      },
    },
    oss: { async putBuffer(key) { return key; } },
    httpGet: async () => Buffer.from('%PDF-1.4'),
    randomHex: () => 'cafebabe',
    matchUser: async () => 'user-1',
    insertLabOrder: async (order) => ({ id: 1, ...order }),
    log() {},
    _queries: queries,
  };
  return { ...args, ...overrides };
}

describe('import-qcs-orders buildImportDeps', () => {
  test('findLabOrder selects the columns the import needs by lab and external order id', async () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    const args = builderArgs();
    const deps = buildImportDeps(args);

    const row = await deps.findLabOrder('qcs', 'QCS-1');

    assert.deepEqual(row, { id: 7, report_pdf_key: null });
    assert.equal(args._queries.length, 1);
    // status drives the drift check; external_order_id is needed for the
    // UPDATE's WHERE clause when refreshing a drifted row.
    assert.match(args._queries[0].sql, /SELECT id, report_pdf_key, external_order_id, status FROM lab_orders/);
    assert.deepEqual(args._queries[0].params, ['qcs', 'QCS-1']);
  });

  test('updateLabOrder only writes when the stored status drifted from the lab', async () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    const calls = [];
    const args = builderArgs({
      updateLabOrder: async (match, raw) => { calls.push({ match, raw }); return { id: match.id }; },
    });
    const deps = buildImportDeps(args);
    const stored = { id: 7, external_order_id: 'QCS-1', status: '处理中' };

    const unchanged = await deps.updateLabOrder(stored, { id: 'QCS-1', progress: 'processing' });
    assert.equal(unchanged, null);
    assert.equal(calls.length, 0);

    const refreshed = await deps.updateLabOrder(stored, { id: 'QCS-1', progress: 'complete' });
    assert.deepEqual(refreshed, { id: 7 });
    assert.equal(calls.length, 1);
    // The real updateLabOrder keys its WHERE on id AND external_order_id.
    assert.deepEqual(calls[0].match, { id: 7, externalOrderId: 'QCS-1' });
  });

  test('isOrderComplete maps QCS progress complete to true, others false', () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    const deps = buildImportDeps(builderArgs());

    assert.equal(deps.isOrderComplete({ progress: 'complete' }), true);
    assert.equal(deps.isOrderComplete({ data: { progress: 'complete' } }), true);
    assert.equal(deps.isOrderComplete({ progress: 'processing' }), false);
    assert.equal(deps.isOrderComplete({}), false);
  });

  test('setLabOrderPdfKey updates report_pdf_key for the row', async () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    const args = builderArgs();
    const deps = buildImportDeps(args);

    await deps.setLabOrderPdfKey(7, 'lab-reports/qcs/QCS-1/42-cafebabe.pdf');

    assert.equal(args._queries.length, 1);
    assert.match(args._queries[0].sql, /UPDATE lab_orders SET report_pdf_key = \$2 WHERE id = \$1/);
    assert.deepEqual(args._queries[0].params, [7, 'lab-reports/qcs/QCS-1/42-cafebabe.pdf']);
  });

  test('insertLabOrder wiring adds credentials, source, and mapped status', async () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    const rows = [];
    const args = builderArgs({
      insertLabOrder: async (order) => { rows.push(order); return { id: 1, ...order }; },
    });
    const deps = buildImportDeps(args);

    await deps.insertLabOrder({
      lab_name: 'qcs',
      user_id: 'user-1',
      external_order_id: 'QCS-1',
      lab_response: { progress: 'complete' },
    });
    await deps.insertLabOrder({
      lab_name: 'qcs',
      user_id: 'user-1',
      external_order_id: 'QCS-2',
      lab_response: { progress: 'processing' },
    });

    assert.equal(rows[0].api_key, 'AK');
    assert.equal(rows[0].api_secret, 'AS');
    assert.deepEqual(rows[0].lab_request, { source: 'import-qcs-orders' });
    assert.deepEqual(rows[0].lab_last_result, { progress: 'complete' });
    assert.deepEqual(rows[0].lab_final_result, { progress: 'complete' });
    assert.equal(rows[0].status, '已完成');
    assert.equal(rows[1].lab_final_result, null);
    assert.equal(rows[1].status, '处理中');
  });

  test('wires storeReportPdf to oss upload and exposes runImport passthroughs', async () => {
    const { buildImportDeps } = require('../scripts/import-qcs-orders');
    require('../src/functions/lab/lib/adapters/qcs').clearTokenCache();
    const uploads = [];
    const transport = {
      async post() { return { data: { access_token: 'tok', expires_in: 7200 } }; },
      async get() { return { data: { data: { url: 'https://files.qcs/tmp.pdf', size: 8 } } }; },
    };
    const args = builderArgs({
      opts: { labName: 'qcs', dryRun: true, progress: 'complete', ak: 'AK', as: 'AS' },
      config: {
        api_base_url: 'https://qcs.example/third-party',
        api_key: 'AK',
        api_secret: 'AS',
        transport,
        now: () => 1000,
      },
      oss: { async putBuffer(key, buffer, options) { uploads.push({ key, buffer, options }); return key; } },
    });
    const deps = buildImportDeps(args);

    const key = await deps.storeReportPdf(
      { id: 'QCS-9' },
      { goods: [{ id: 42, progress: 'completed', bodyindex_panels: [] }] }
    );

    assert.equal(key, 'lab-reports/qcs/QCS-9/42-cafebabe.pdf');
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0].options, { contentType: 'application/pdf' });

    assert.equal(deps.labName, 'qcs');
    assert.equal(deps.dryRun, true);
    assert.equal(deps.config, args.config);
    assert.equal(typeof deps.listOrders, 'function');
    assert.equal(typeof deps.fetchOrder, 'function');
    assert.equal(typeof deps.phoneFromOrder, 'function');
    assert.equal(typeof deps.matchUser, 'function');
    assert.equal(typeof deps.log, 'function');
  });
});

describe('import-qcs-orders export rows', () => {
  const detail = {
    id: 'QCS-1',
    // 534466800 is 1986-12-08T23:00:00Z; 1530859745 is 2018-07-06T06:49:05Z
    // (= 2018-07-06 14:49:05 in Asia/Shanghai).
    created_at: 1530859745,
    member: { name: '张三', gender: 'male', birthday: 534466800, mobile: '13888888888' },
    goods: [
      { id: '415bfc38', name: '糖化血红蛋白' },
      { id: '2053', name: 'DNA甲基化年龄检测' },
    ],
  };

  test('expands each good into its own row carrying the member columns', () => {
    const { orderExportRows } = require('../scripts/import-qcs-orders');

    const rows = orderExportRows(detail, '13888888888');

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      name: '张三',
      gender: 'male',
      dateOfBirth: '1986-12-08',
      phoneNumber: '13888888888',
      orderNo: 'QCS-1',
      collectionTime: '2018-07-06 14:49:05',
      projectId: '415bfc38',
      projectName: '糖化血红蛋白',
    });
    assert.equal(rows[1].projectId, '2053');
    assert.equal(rows[1].projectName, 'DNA甲基化年龄检测');
    assert.equal(rows[1].name, '张三');
  });

  test('unwraps a { data: order } envelope', () => {
    const { orderExportRows } = require('../scripts/import-qcs-orders');

    const rows = orderExportRows({ data: detail }, '13888888888');

    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, '张三');
    assert.equal(rows[0].collectionTime, '2018-07-06 14:49:05');
  });

  test('emits one row with blank project columns when the order has no goods', () => {
    const { orderExportRows } = require('../scripts/import-qcs-orders');

    const rows = orderExportRows({ ...detail, goods: [] }, '');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].projectId, '');
    assert.equal(rows[0].projectName, '');
    assert.equal(rows[0].phoneNumber, '');
    assert.equal(rows[0].dateOfBirth, '1986-12-08');
  });

  test('leaves missing timestamps blank rather than emitting epoch dates', () => {
    const { orderExportRows } = require('../scripts/import-qcs-orders');

    const rows = orderExportRows({ member: { name: 'x' }, goods: [] }, '');

    assert.equal(rows[0].dateOfBirth, '');
    assert.equal(rows[0].collectionTime, '');
  });

  test('accepts millisecond timestamps as well as QCS seconds', () => {
    const { orderExportRows } = require('../scripts/import-qcs-orders');

    const rows = orderExportRows(
      { created_at: 1530859745000, member: { birthday: 534466800000 }, goods: [] },
      ''
    );

    assert.equal(rows[0].dateOfBirth, '1986-12-08');
    assert.equal(rows[0].collectionTime, '2018-07-06 14:49:05');
  });

  test('exposes the column headers in the order the spreadsheet requires', () => {
    const { EXPORT_COLUMNS, orderExportRows } = require('../scripts/import-qcs-orders');

    assert.deepEqual(EXPORT_COLUMNS.map((c) => c.header), [
      'Name',
      'Gender',
      'Date of Birth',
      'Phone Number',
      'Order No.',
      'Collection Time',
      'Project ID',
      'Project Name',
    ]);
    // Every column must address a field the rows actually carry.
    const row = orderExportRows(detail, '13888888888')[0];
    assert.deepEqual(EXPORT_COLUMNS.map((c) => c.key).sort(), Object.keys(row).sort());
  });
});

function exportDeps(overrides = {}) {
  const written = [];
  const deps = {
    config: { api_base_url: 'https://qcs.example/third-party' },
    async listOrders() { return [{ id: 'QCS-1' }, { id: 'QCS-2' }]; },
    async fetchOrder(id) {
      return {
        id,
        created_at: 1530859745,
        member: { name: id, gender: 'female', birthday: 534466800, mobile: '13800000001' },
        goods: [{ id: 'g1', name: 'p1' }, { id: 'g2', name: 'p2' }],
      };
    },
    phoneFromOrder(detail) { return detail.member.mobile; },
    async writeRows(rows) { written.push(...rows); },
    log() {},
    _written: written,
  };
  return { ...deps, ...overrides };
}

describe('import-qcs-orders runExport', () => {
  test('writes every good of every order without touching the database', async () => {
    const { runExport } = require('../scripts/import-qcs-orders');
    const deps = exportDeps();

    const summary = await runExport(deps);

    assert.equal(summary.total, 2);
    assert.equal(summary.rows, 4);
    assert.equal(summary.errors, 0);
    assert.equal(deps._written.length, 4);
    assert.equal(deps._written[0].name, 'QCS-1');
    assert.equal(deps._written[0].projectId, 'g1');
    assert.equal(deps._written[0].phoneNumber, '13800000001');
    assert.equal(deps._written[3].name, 'QCS-2');
    assert.equal(deps._written[3].projectId, 'g2');
  });

  test('records an error and continues when one order detail fails', async () => {
    const { runExport } = require('../scripts/import-qcs-orders');
    const base = exportDeps();
    const deps = exportDeps({
      async fetchOrder(id) {
        if (id === 'QCS-1') throw new Error('boom');
        return base.fetchOrder(id);
      },
    });

    const summary = await runExport(deps);

    assert.equal(summary.total, 2);
    assert.equal(summary.errors, 1);
    assert.equal(summary.rows, 2);
    assert.equal(deps._written.every((r) => r.name === 'QCS-2'), true);
  });

  test('reports per-order progress with position, total and row count', async () => {
    const { runExport } = require('../scripts/import-qcs-orders');
    const events = [];
    const deps = exportDeps({ onProgress(event) { events.push(event); } });

    await runExport(deps);

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { index: 1, total: 2, orderId: 'QCS-1', rows: 2, outcome: 'exported' });
    assert.deepEqual(events[1], { index: 2, total: 2, orderId: 'QCS-2', rows: 2, outcome: 'exported' });
  });
});

describe('import-qcs-orders makeXlsxWriter', () => {
  test('writes a header row plus every appended row to a readable workbook', async () => {
    const { makeXlsxWriter, EXPORT_COLUMNS } = require('../scripts/import-qcs-orders');
    const os = require('node:os');
    const path = require('node:path');
    const fs = require('node:fs');
    const ExcelJS = require('exceljs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcs-export-'));
    const file = path.join(dir, 'orders.xlsx');
    try {
      const writer = makeXlsxWriter({ filePath: file, columns: EXPORT_COLUMNS });
      await writer.writeRows([{
        name: '张三', gender: 'male', dateOfBirth: '1986-12-08', phoneNumber: '13888888888',
        orderNo: 'QCS-1', collectionTime: '2018-07-06 14:49:05', projectId: 'g1', projectName: '糖化血红蛋白',
      }]);
      await writer.commit();

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const sheet = workbook.worksheets[0];
      assert.deepEqual(sheet.getRow(1).values.slice(1), EXPORT_COLUMNS.map((c) => c.header));
      assert.deepEqual(sheet.getRow(2).values.slice(1), [
        '张三', 'male', '1986-12-08', '13888888888', 'QCS-1', '2018-07-06 14:49:05', 'g1', '糖化血红蛋白',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('import-qcs-orders missingOssEnv', () => {
  test('lists absent OSS credential vars and is empty when all present', () => {
    const { missingOssEnv } = require('../scripts/import-qcs-orders');

    assert.deepEqual(
      missingOssEnv({}),
      ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET']
    );
    assert.deepEqual(
      missingOssEnv({ OSS_ACCESS_KEY_ID: 'id', OSS_BUCKET: 'b' }),
      ['OSS_ACCESS_KEY_SECRET']
    );
    assert.deepEqual(
      missingOssEnv({ OSS_ACCESS_KEY_ID: 'id', OSS_ACCESS_KEY_SECRET: 's', OSS_BUCKET: 'b' }),
      []
    );
  });
});

describe('import-qcs-orders parseArgs', () => {
  test('reads flags and falls back to env for credentials', () => {
    const { parseArgs } = require('../scripts/import-qcs-orders');

    const fromFlags = parseArgs(
      ['--ak', 'AK1', '--as', 'AS1', '--env', 'prod', '--base-url', 'https://q/third-party', '--progress', 'complete', '--dry-run'],
      {}
    );
    assert.equal(fromFlags.ak, 'AK1');
    assert.equal(fromFlags.as, 'AS1');
    assert.equal(fromFlags.env, 'prod');
    assert.equal(fromFlags.baseUrl, 'https://q/third-party');
    assert.equal(fromFlags.progress, 'complete');
    assert.equal(fromFlags.dryRun, true);

    const exporting = parseArgs(['--export', 'out/orders.xlsx'], {});
    assert.equal(exporting.exportPath, 'out/orders.xlsx');

    const fromEnv = parseArgs([], { QCS_AK: 'EAK', QCS_AS: 'EAS' });
    assert.equal(fromEnv.ak, 'EAK');
    assert.equal(fromEnv.as, 'EAS');
    assert.equal(fromEnv.env, 'dev');
    assert.equal(fromEnv.dryRun, false);
  });
});
