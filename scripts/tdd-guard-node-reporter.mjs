// Custom node:test reporter that writes results to .claude/tdd-guard/data/test.json
// in the schema tdd-guard expects (matches the tdd-guard-vitest output shape), so
// TDD Guard can gate backend (node:test) edits the same way it does frontend (vitest).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.env.TDD_GUARD_PROJECT_ROOT || process.cwd();
const OUT_FILE = path.join(PROJECT_ROOT, '.claude', 'tdd-guard', 'data', 'test.json');

export default async function tddGuardReporter(source) {
  const moduleMap = new Map();
  let anyFailed = false;

  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;

    const moduleId = event.data.file || 'unknown';
    if (!moduleMap.has(moduleId)) moduleMap.set(moduleId, []);

    const state = event.type === 'test:pass' ? 'passed' : 'failed';
    const entry = { name: event.data.name, fullName: event.data.name, state };
    if (state === 'failed') {
      anyFailed = true;
      const err = event.data.details && event.data.details.error;
      entry.errors = [{ message: String((err && err.message) || err || 'test failed') }];
    }
    moduleMap.get(moduleId).push(entry);
  }

  const testModules = [...moduleMap.entries()].map(([moduleId, tests]) => ({ moduleId, tests }));
  const output = { testModules, unhandledErrors: [], reason: anyFailed ? 'failed' : 'passed' };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(output, null, 2));
}
