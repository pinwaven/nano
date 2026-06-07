'use strict';

function printLists(rows, header = false) {
  const widths = new Array(rows[0].length).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(String(row[i]).length, widths[i]);
    }
  }
  const result = rows.map(row =>
    row.map((col, i) => String(col).padStart(widths[i])).join(' | ')
  );
  if (header && result.length > 1) {
    result.splice(1, 0, '-'.repeat(result[0].length));
  }
  return result.join('\n');
}

function printDicts(rows) {
  const lists = [Object.keys(rows[0])];
  for (const row of rows) lists.push(Object.values(row));
  return printLists(lists, true);
}

function printDataclasses(instances) {
  const dicted = instances.map(d => (d.toObject ? d.toObject() : Object.assign({}, d)));
  return printDicts(dicted);
}

module.exports = { printLists, printDicts, printDataclasses };
