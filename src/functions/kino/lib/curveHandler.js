'use strict';

const { parseBinCurve } = require('./curveParser');

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = {};
  let pos = 0;

  while (pos < buffer.length) {
    const sepIdx = buffer.indexOf(sep, pos);
    if (sepIdx === -1) break;
    pos = sepIdx + sep.length;
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break;
    pos += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8');
    pos = headerEnd + 4;

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const nextSep = buffer.indexOf(sep, pos);
    const bodyEnd = nextSep === -1 ? buffer.length : nextSep - 2;
    parts[name] = buffer.slice(pos, bodyEnd);
    pos = bodyEnd;
  }
  return parts;
}

async function handlePostKinoCurve({ pool, rawBody, contentType, machine }) {
  const boundaryMatch = (contentType || '').match(/boundary=["']?([^\s;"']+)/);
  if (!boundaryMatch) {
    return { statusCode: 400, success: false, error: 'missing_multipart_boundary' };
  }
  const boundary = boundaryMatch[1];

  const buffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody || ''), 'base64');

  const parts = parseMultipart(buffer, boundary);

  const qrcode = parts.qrcode ? parts.qrcode.toString('utf8').trim() : null;
  if (!qrcode) {
    return { statusCode: 400, success: false, error: 'qrcode_required' };
  }

  const refValRaw = parts.reference_values ? parts.reference_values.toString('utf8').trim() : null;
  if (!refValRaw) {
    return { statusCode: 400, success: false, error: 'reference_values_required' };
  }
  let referenceValues;
  try {
    referenceValues = JSON.parse(refValRaw);
  } catch {
    return { statusCode: 400, success: false, error: 'reference_values_invalid_json' };
  }

  const curveFile = parts.curve_file;
  if (!curveFile || curveFile.length === 0) {
    return { statusCode: 400, success: false, error: 'curve_file_required' };
  }

  let parsed;
  try {
    parsed = parseBinCurve(curveFile);
  } catch (err) {
    return { statusCode: 422, success: false, error: err.message, code: err.code };
  }

  const result = await pool.query(
    `INSERT INTO kino_curve (kino_device_id, chip_code, curve, reference_values)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [machine.id, qrcode, parsed.curve, JSON.stringify(referenceValues)]
  );

  console.log(JSON.stringify({
    level: 'INFO',
    msg: 'kino_curve stored',
    data: { id: result.rows[0].id, chip_code: qrcode, samples: parsed.curve.length, device_id: machine.id },
  }));

  return { success: true, id: result.rows[0].id };
}

module.exports = { handlePostKinoCurve };
