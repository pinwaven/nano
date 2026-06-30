/**
 * node:test custom reporter that writes results in the tdd-guard schema.
 *
 * tdd-guard (PreToolUse hook) reads `.claude/tdd-guard/data/test.json` to decide
 * Red/Green. The official reporters only cover jest/vitest, so this bridges
 * node's built-in test runner (`node --test`) to that JSON contract.
 *
 * Schema (src/contracts/schemas/reporterSchemas.ts):
 *   { testModules: [{ moduleId, tests: [{ name, fullName, state, errors? }] }],
 *     reason: 'passed' | 'failed' | 'interrupted' }
 *
 * Usage:
 *   node --test --test-reporter=./scripts/tdd-guard-node-reporter.mjs \
 *               --test-reporter-destination=stdout tests/some.test.js
 *
 * @module scripts/tdd-guard-node-reporter
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RESULTS_PATH = path.join(process.cwd(), '.claude', 'tdd-guard', 'data', 'test.json');

function stateFor(eventType, data) {
  if (eventType === 'test:fail') return 'failed';
  if (data.skip || data.todo) return 'skipped';
  return 'passed';
}

export default async function* tddGuardNodeReporter(source) {
  const byModule = new Map();
  let anyFail = false;
  let counts = { passed: 0, failed: 0, skipped: 0 };

  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const data = event.data;
    // Suites emit pass/fail too; only leaf tests belong in the report.
    if (data.details?.type === 'suite') continue;

    const moduleId = data.file || 'unknown';
    if (!byModule.has(moduleId)) byModule.set(moduleId, []);

    const state = stateFor(event.type, data);
    counts[state] += 1;
    if (state === 'failed') anyFail = true;

    const test = { name: data.name, fullName: data.name, state };
    if (state === 'failed') {
      const error = data.details?.error;
      test.errors = [{
        message: error?.message || String(error || 'test failed'),
        ...(error?.stack ? { stack: String(error.stack) } : {}),
      }];
    }
    byModule.get(moduleId).push(test);
  }

  const result = {
    testModules: [...byModule].map(([moduleId, tests]) => ({ moduleId, tests })),
    reason: anyFail ? 'failed' : 'passed',
  };

  try {
    await mkdir(path.dirname(RESULTS_PATH), { recursive: true });
    await writeFile(RESULTS_PATH, JSON.stringify(result, null, 2));
  } catch (err) {
    yield `tdd-guard reporter: failed to write ${RESULTS_PATH}: ${err.message}\n`;
  }

  yield `tdd-guard: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped → ${RESULTS_PATH}\n`;
}
