// Minimal TDD Guard reporter for node:test.
// Consumes the node:test event stream and writes results to
// .claude/tdd-guard/data/test.json in the schema TDD Guard expects.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.cwd(), '.claude/tdd-guard/data/test.json');
const moduleMap = new Map();

function moduleFor(file) {
  const id = file || 'unknown';
  if (!moduleMap.has(id)) moduleMap.set(id, { moduleId: id, tests: [] });
  return moduleMap.get(id);
}

export default async function* reporter(source) {
  for await (const event of source) {
    const { type, data } = event;
    if (type === 'test:pass' || type === 'test:fail') {
      // Skip suite-level aggregate events; only record leaf tests.
      if (data.details && data.details.type === 'suite') continue;
      const mod = moduleFor(data.file);
      const state = type === 'test:pass' ? 'passed' : 'failed';
      const test = { name: data.name, fullName: data.name, state };
      if (state === 'failed') {
        const err = data.details && data.details.error;
        const message = err ? (err.cause?.message || err.message || String(err)) : 'test failed';
        test.errors = [{ message }];
      }
      mod.tests.push(test);
    }
    yield '';
  }

  const testModules = [...moduleMap.values()];
  const anyFailed = testModules.some((m) => m.tests.some((t) => t.state === 'failed'));
  const results = { testModules, reason: anyFailed ? 'failed' : 'passed' };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}
