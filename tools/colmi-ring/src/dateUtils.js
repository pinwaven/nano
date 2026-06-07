'use strict';

function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfDay(d) {
  return new Date(startOfDay(d).getTime() + 24 * 60 * 60 * 1000 - 1);
}

function* datesBetween(start, end) {
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) throw new Error('start is after end');
  for (let i = 0; i <= diffDays; i++) {
    yield new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
  }
}

function now() {
  return new Date();
}

function minutesSoFar(d) {
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const delta = d.getTime() - midnight;
  return Math.round(delta / 60000) + 1;
}

function isToday(d) {
  const n = now();
  return d.getUTCFullYear() === n.getUTCFullYear()
    && d.getUTCMonth() === n.getUTCMonth()
    && d.getUTCDate() === n.getUTCDate();
}

module.exports = { startOfDay, endOfDay, datesBetween, now, minutesSoFar, isToday };
