'use strict';

/**
 * Tablestore-backed storage for biomarker-estimator.
 *
 * Maintains the same interface as the original JSON-file db:
 *   findByTestId(testId)           → Promise<record|null>
 *   insert({ user_id, test_id, input, output })  → Promise<void>
 *
 * The stored record shape in OTS:
 *   PK:  user_id (string), test_id (string)
 *   COL: chrono_age, biomarker_values, tags, biometrics, created_at
 *        (input/output stored as biomarker_values etc — see saveTest)
 *
 * For the estimator we store the raw input/output JSON in dedicated
 * columns so the interface stays backward-compatible.
 */

const TableStore = require('tablestore');

const TABLE_NAME = 'user_tests';

let _client = null;

function getClient() {
  if (_client) return _client;

  const accessKeyId     = process.env.OTS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OTS_ACCESS_KEY_SECRET;
  const endpoint        = process.env.OTS_ENDPOINT || 'https://nanovate.cn-shanghai.ots.aliyuncs.com';
  const instancename    = process.env.OTS_INSTANCE  || 'nanovate';

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('OTS_ACCESS_KEY_ID and OTS_ACCESS_KEY_SECRET must be set');
  }

  _client = new TableStore.Client({
    accessKeyId,
    secretAccessKey: accessKeySecret,
    endpoint,
    instancename,
    maxRetries: 3,
  });

  return _client;
}

function promisify(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function fromCell(cell) {
  const v = cell.columnValue;
  if (v && typeof v === 'object' && typeof v.toNumber === 'function') {
    return v.toNumber();
  }
  return v;
}

function parseRow(row) {
  const result = {};
  for (const kv of row.primaryKey) {
    // SDK returns either { name, value } or { key: value } depending on version
    if (kv.name !== undefined) {
      result[kv.name] = kv.value;
    } else {
      const key = Object.keys(kv)[0];
      result[key] = kv[key];
    }
  }
  for (const col of (row.attributes || [])) {
    result[col.columnName] = fromCell(col);
  }
  return result;
}

/**
 * Find a record by test_id.
 * Uses getRange scan (test_id is 2nd PK component — need userId to do a point
 * lookup, so we scan instead since userId may not be known at call time).
 * Returns { user_id, test_id, input, output } or null.
 */
async function findByTestId(testId) {
  const client = getClient();

  const params = {
    tableName: TABLE_NAME,
    direction: TableStore.Direction.FORWARD,
    inclusiveStartPrimaryKey: [
      { user_id: TableStore.INF_MIN },
      { test_id: testId },
    ],
    exclusiveEndPrimaryKey: [
      { user_id: TableStore.INF_MAX },
      { test_id: testId },
    ],
    maxVersions: 1,
    limit: 5,
  };

  // GetRange with exact test_id bounds may not work because test_id is 2nd key.
  // Fall back to a full scan with a filter-like approach: scan all and match.
  const scanParams = {
    tableName: TABLE_NAME,
    direction: TableStore.Direction.FORWARD,
    inclusiveStartPrimaryKey: [
      { user_id: TableStore.INF_MIN },
      { test_id: TableStore.INF_MIN },
    ],
    exclusiveEndPrimaryKey: [
      { user_id: TableStore.INF_MAX },
      { test_id: TableStore.INF_MAX },
    ],
    maxVersions: 1,
    limit: 500,
  };

  let token = null;

  do {
    if (token) scanParams.token = token;
    const data = await promisify(client, 'getRange', scanParams);

    if (data.rows) {
      for (const row of data.rows) {
        const parsed = parseRow(row);
        if (parsed.test_id === testId) {
          // Map stored columns back to the legacy interface
          return {
            user_id:  parsed.user_id,
            test_id:  parsed.test_id,
            input:    parsed.raw_input  || null,
            output:   parsed.raw_output || null,
          };
        }
      }
    }

    token = data.nextStartPrimaryKey;
  } while (token);

  return null;
}

/**
 * Insert a record.
 * @param {{ user_id: string, test_id: string, input: string, output: string }} record
 */
async function insert(record) {
  const client = getClient();

  const { user_id, test_id, input, output } = record;

  // Parse input to extract structured fields for the shared schema
  let chrono_age = 0;
  let biomarker_values = {};
  let tags = [];
  let biometrics = {};

  try {
    const inp = typeof input === 'string' ? JSON.parse(input) : input;
    chrono_age       = inp.ChronoAge       || 0;
    biomarker_values = inp.BiomarkerValues || {};
    tags             = inp.Tags            || [];
    biometrics       = inp.Biometrics      || {};
  } catch (_) {}

  const attrCols = [
    { chrono_age:       typeof chrono_age === 'number' && !Number.isInteger(chrono_age)
                          ? chrono_age
                          : TableStore.Long.fromNumber(chrono_age) },
    { biomarker_values: JSON.stringify(biomarker_values) },
    { tags:             JSON.stringify(tags) },
    { biometrics:       JSON.stringify(biometrics) },
    { created_at:       TableStore.Long.fromNumber(Date.now()) },
    // Store raw input/output for backward compat
    { raw_input:  typeof input  === 'string' ? input  : JSON.stringify(input)  },
    { raw_output: typeof output === 'string' ? output : JSON.stringify(output) },
  ];

  const putParams = {
    tableName: TABLE_NAME,
    condition: new TableStore.Condition(
      TableStore.RowExistenceExpectation.IGNORE,
      null
    ),
    primaryKey: [
      { user_id: user_id },
      { test_id: test_id },
    ],
    attributeColumns: attrCols,
    returnContent: { returnType: TableStore.ReturnType.Primarykey },
  };

  await promisify(client, 'putRow', putParams);
}

module.exports = { findByTestId, insert };
