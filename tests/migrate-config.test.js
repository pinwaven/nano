const assert = require('assert');
const { describe, test } = require('node:test');

const { resolveMigrationConfig } = require('../scripts/migrate');

describe('migration config', () => {
  test('test environment loads .env then .env.test and uses DATABASE_URL_TEST', () => {
    const loaded = [];
    const env = {
      DATABASE_URL: 'postgres://dev',
      DATABASE_URL_TEST: 'postgres://test',
      DATABASE_URL_PROD: 'postgres://prod',
    };

    const config = resolveMigrationConfig(['--env', 'test'], {
      env,
      dotenvConfig: (options) => {
        loaded.push(options.path);
        return { parsed: {} };
      },
      cwd: '/repo',
    });

    assert.equal(config.envTarget, 'test');
    assert.equal(config.connectionEnvVar, 'DATABASE_URL_TEST');
    assert.equal(config.connString, 'postgres://test');
    assert.deepEqual(loaded, ['/repo/.env', '/repo/.env.test']);
  });
});
