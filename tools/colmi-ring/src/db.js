'use strict';

const Database = require('better-sqlite3');
const { startOfDay, endOfDay } = require('./dateUtils');
const hr = require('./hr');
const steps = require('./steps');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rings (
  ring_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  address   TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS syncs (
  sync_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_id   INTEGER NOT NULL REFERENCES rings(ring_id),
  timestamp TEXT NOT NULL,
  comment   TEXT
);

CREATE TABLE IF NOT EXISTS heart_rates (
  heart_rate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  reading       INTEGER NOT NULL,
  timestamp     TEXT NOT NULL,
  ring_id       INTEGER NOT NULL REFERENCES rings(ring_id),
  sync_id       INTEGER NOT NULL REFERENCES syncs(sync_id),
  UNIQUE(ring_id, timestamp)
);

CREATE TABLE IF NOT EXISTS sport_details (
  sport_detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
  calories        INTEGER NOT NULL,
  steps           INTEGER NOT NULL,
  distance        INTEGER NOT NULL,
  timestamp       TEXT NOT NULL,
  ring_id         INTEGER NOT NULL REFERENCES rings(ring_id),
  sync_id         INTEGER NOT NULL REFERENCES syncs(sync_id),
  UNIQUE(ring_id, timestamp)
);
`;

function toISO(d) {
  return d instanceof Date ? d.toISOString() : d;
}

function getDb(path = null) {
  const db = path ? new Database(path) : new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function createOrFindRing(db, address) {
  let ring = db.prepare('SELECT * FROM rings WHERE address = ?').get(address);
  if (!ring) {
    const info = db.prepare('INSERT INTO rings (address) VALUES (?)').run(address);
    ring = { ring_id: info.lastInsertRowid, address };
  }
  return ring;
}

function fullSync(db, data) {
  const ring = createOrFindRing(db, data.address);
  const syncInfo = db
    .prepare('INSERT INTO syncs (ring_id, timestamp) VALUES (?, ?)')
    .run(ring.ring_id, toISO(new Date()));
  const syncId = syncInfo.lastInsertRowid;

  _addHeartRates(db, syncId, ring, data);
  _addSportDetails(db, syncId, ring, data);
}

function _addHeartRates(db, syncId, ring, data) {
  const insertHr = db.prepare(
    'INSERT OR IGNORE INTO heart_rates (reading, timestamp, ring_id, sync_id) VALUES (?, ?, ?, ?)'
  );

  for (const log of data.heartRates) {
    if (log instanceof hr.NoData) continue;

    const start = toISO(startOfDay(log.timestamp));
    const end = toISO(endOfDay(log.timestamp));
    const existing = {};
    for (const row of db
      .prepare('SELECT timestamp, reading FROM heart_rates WHERE ring_id = ? AND timestamp >= ? AND timestamp <= ?')
      .all(ring.ring_id, start, end)) {
      existing[row.timestamp] = row.reading;
    }

    for (const [reading, ts] of log.heartRatesWithTimes()) {
      if (reading === 0) continue;
      const tsISO = toISO(ts);
      if (tsISO in existing) {
        if (existing[tsISO] !== reading) {
          console.error(`Inconsistent data: ${tsISO} is ${existing[tsISO]} in db but ${reading} from ring`);
        }
      } else {
        insertHr.run(reading, tsISO, ring.ring_id, syncId);
      }
    }
  }
}

function _addSportDetails(db, syncId, ring, data) {
  const allDetails = [];
  for (const log of data.sportDetails) {
    if (log instanceof steps.NoData || !Array.isArray(log)) continue;
    allDetails.push(...log);
  }
  if (allDetails.length === 0) return;

  const timestamps = allDetails.map((d) => d.timestamp.getTime());
  const start = toISO(startOfDay(new Date(Math.min(...timestamps))));
  const end = toISO(endOfDay(new Date(Math.max(...timestamps))));

  const existing = {};
  for (const row of db
    .prepare('SELECT sport_detail_id, timestamp FROM sport_details WHERE ring_id = ? AND timestamp >= ? AND timestamp <= ?')
    .all(ring.ring_id, start, end)) {
    existing[row.timestamp] = row.sport_detail_id;
  }

  const insertSd = db.prepare(
    'INSERT OR IGNORE INTO sport_details (calories, steps, distance, timestamp, ring_id, sync_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateSd = db.prepare(
    'UPDATE sport_details SET calories = ?, steps = ?, distance = ? WHERE sport_detail_id = ?'
  );

  for (const detail of allDetails) {
    const tsISO = toISO(detail.timestamp);
    if (tsISO in existing) {
      updateSd.run(detail.calories, detail.steps, detail.distance, existing[tsISO]);
    } else {
      insertSd.run(detail.calories, detail.steps, detail.distance, tsISO, ring.ring_id, syncId);
    }
  }
}

function getLastSync(db, ringAddress) {
  const row = db
    .prepare(
      'SELECT MAX(s.timestamp) as ts FROM syncs s JOIN rings r ON s.ring_id = r.ring_id WHERE r.address = ?'
    )
    .get(ringAddress);
  return row && row.ts ? new Date(row.ts) : null;
}

module.exports = { getDb, createOrFindRing, fullSync, getLastSync };
