const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

function baseDeps(overrides = {}) {
  const inserted = [];
  const ingested = [];
  const deps = {
    config: { api_base_url: 'https://qcs.example/third-party' },
    labName: 'qcs',
    async listOrders() { return [{ id: 'QCS-1' }]; },
    async fetchOrder(id) { return { id, member: { mobile: '13800000001' } }; },
    phoneFromOrder(detail) { return detail.member.mobile; },
    async matchUser() { return 'user-1'; },
    async findLabOrder() { return null; },
    async insertLabOrder(order) { inserted.push(order); return { id: inserted.length, ...order }; },
    async ingestOrderResults(userId) { ingested.push(userId); return 99; },
    log() {},
    _inserted: inserted,
    _ingested: ingested,
  };
  return { ...deps, ...overrides };
}

describe('import-qcs-orders runImport', () => {
  test('inserts lab_order and ingests results for a matched order', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps();

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.ordersInserted, 1);
    assert.equal(summary.reportsInserted, 1);
    assert.equal(summary.skippedNoUser, 0);
    assert.equal(deps._inserted.length, 1);
    assert.equal(deps._inserted[0].lab_name, 'qcs');
    assert.equal(deps._inserted[0].user_id, 'user-1');
    assert.equal(deps._inserted[0].external_order_id, 'QCS-1');
    assert.deepEqual(deps._ingested, ['user-1']);
  });

  test('skips orders whose phone matches no user and does not insert', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ async matchUser() { return null; } });

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 0);
    assert.equal(summary.skippedNoUser, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(summary.reportsInserted, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._ingested, []);
  });

  test('skips orders already present in lab_orders (dedup on re-run)', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ async findLabOrder() { return { id: 7 }; } });

    const summary = await runImport(deps);

    assert.equal(summary.total, 1);
    assert.equal(summary.matched, 1);
    assert.equal(summary.skippedDuplicate, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(summary.reportsInserted, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._ingested, []);
  });

  test('dry-run matches but performs no inserts or ingestion', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({ dryRun: true });

    const summary = await runImport(deps);

    assert.equal(summary.matched, 1);
    assert.equal(summary.ordersInserted, 0);
    assert.equal(summary.reportsInserted, 0);
    assert.equal(summary.skippedDuplicate, 0);
    assert.equal(deps._inserted.length, 0);
    assert.deepEqual(deps._ingested, []);
  });

  test('records an error and continues when one order fails', async () => {
    const { runImport } = require('../scripts/import-qcs-orders');
    const deps = baseDeps({
      async listOrders() { return [{ id: 'BAD' }, { id: 'QCS-2' }]; },
      async fetchOrder(id) {
        if (id === 'BAD') throw new Error('boom');
        return { id, member: { mobile: '13800000002' } };
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

    const fromEnv = parseArgs([], { QCS_AK: 'EAK', QCS_AS: 'EAS' });
    assert.equal(fromEnv.ak, 'EAK');
    assert.equal(fromEnv.as, 'EAS');
    assert.equal(fromEnv.env, 'dev');
    assert.equal(fromEnv.dryRun, false);
  });
});
