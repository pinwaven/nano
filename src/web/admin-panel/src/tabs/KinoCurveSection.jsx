import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Search, Download, Activity } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import * as XLSX from 'xlsx';
import { findSlopeRegions, buildCurveMarkers } from '../utils/kinoCurveAnalysis.js';

const MARKER_COLORS = { start: '#10b981', peak: '#ef4444', end: '#3b82f6' };
// Fixed-order categorical palette for per-wave chord lines, CVD-validated
// against the light surface (dataviz validator: all checks pass).
const CHORD_COLORS = ['#7c3aed', '#0891b2', '#a16207', '#be185d', '#15803d', '#b45309', '#4338ca', '#0d9488'];
import { buildAreaRatioMatrix, matrixToAoa } from '../utils/kinoCurveMatrix.js';

const LINE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#14b8a6', '#ec4899'];

function curveLabel(c, i) {
  const base = `${c.serial_number || '—'} · ${c.chip_code || `curve ${i}`}`;
  return base;
}

export function KinoCurveSection({ devices = [] }) {
  const [serial, setSerial] = useState('');
  const [chipCode, setChipCode] = useState('');
  const [curves, setCurves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [allDevices, setAllDevices] = useState([]);

  // The `devices` prop is a client-paginated slice, so it only holds one page of
  // serials. Fetch the full device list for the filter dropdown.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await axios.get('/api/kino-devices');
        if (alive) setAllDevices(res?.data?.devices || []);
      } catch {
        /* keep the prop fallback */
      }
    })();
    return () => { alive = false; };
  }, []);

  const serialOptions = useMemo(() => {
    const src = allDevices.length ? allDevices : devices;
    const set = new Set(src.map((d) => d.serial_number).filter(Boolean));
    return [...set].sort();
  }, [allDevices, devices]);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (serial) params.serial_number = serial;
      if (chipCode.trim()) params.chip_code = chipCode.trim();
      const res = await axios.get('/api/kino-curves', { params });
      const rows = (res.data?.curves || []).map((r) => ({
        ...r,
        curve: Array.isArray(r.curve) ? r.curve.map(Number) : [],
      }));
      setCurves(rows);
      setSearched(true);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load curves');
      setCurves([]);
    } finally {
      setLoading(false);
    }
  }

  const maxLen = useMemo(
    () => curves.reduce((m, c) => Math.max(m, c.curve.length), 0),
    [curves],
  );

  const chartData = useMemo(() => {
    const data = new Array(maxLen);
    for (let x = 0; x < maxLen; x++) {
      const row = { x };
      curves.forEach((c, i) => {
        row[`c${i}`] = x < c.curve.length ? c.curve[x] : null;
      });
      data[x] = row;
    }
    return data;
  }, [curves, maxLen]);

  const regionBands = useMemo(() => {
    const bands = [];
    curves.forEach((c, i) => {
      findSlopeRegions(c.curve).forEach((r, ri) => {
        bands.push({
          key: `${i}-${ri}`,
          x1: r.startIndex,
          x2: r.endIndex,
          color: LINE_COLORS[i % LINE_COLORS.length],
        });
      });
    });
    return bands;
  }, [curves]);

  // One start->end chord per detected wave, colored per wave (fixed order
  // across all curves) so overlapping regions stay tellable apart.
  const chordSegments = useMemo(() => {
    const out = [];
    curves.forEach((c, i) => {
      findSlopeRegions(c.curve).forEach((r, ri) => {
        out.push({
          key: `chord-${i}-${ri}`,
          x1: r.startIndex,
          y1: c.curve[r.startIndex],
          x2: r.endIndex,
          y2: c.curve[r.endIndex],
          color: CHORD_COLORS[out.length % CHORD_COLORS.length],
        });
      });
    });
    return out;
  }, [curves]);

  const markerPoints = useMemo(() => {
    const out = [];
    curves.forEach((c, i) => {
      buildCurveMarkers(c.curve).forEach((m, mi) => {
        out.push({ key: `${i}-${m.type}-${mi}`, x: m.x, y: m.y, color: MARKER_COLORS[m.type] });
      });
    });
    return out;
  }, [curves]);

  function handleExport() {
    const model = buildAreaRatioMatrix(curves);
    const aoa = matrixToAoa(model);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AreaRatio');
    XLSX.writeFile(wb, 'kino-area-ratio.xlsx');
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="table-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={14} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>曲线 / Curves</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={serial} onChange={(e) => setSerial(e.target.value)} className="filter-select">
            <option value="">All serial numbers</option>
            {serialOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="text"
            value={chipCode}
            onChange={(e) => setChipCode(e.target.value)}
            placeholder="chip_code (KNC…)"
            className="filter-input"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <button className="btn-primary" type="button" onClick={handleSearch} disabled={loading}>
            <Search size={14} /> {loading ? '…' : 'Search'}
          </button>
          <button className="btn-secondary" type="button" onClick={handleExport} disabled={curves.length === 0}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {error && <div className="error-banner" style={{ margin: '8px 0' }}>{error}</div>}

      {searched && curves.length === 0 && !loading && (
        <div className="empty-row" style={{ padding: 24, textAlign: 'center' }}>No curves found.</div>
      )}

      {curves.length > 0 && (
        <>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '4px 4px 0', fontSize: 12, color: '#64748b' }}>
          {[['start', 'Start'], ['peak', 'Peak'], ['end', 'End']].map(([type, label]) => (
            <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: MARKER_COLORS[type], border: '1.5px solid #fff', boxShadow: '0 0 0 1px #cbd5e1' }} />
              {label}
            </span>
          ))}
        </div>
        <div
          data-testid="curve-chart"
          data-region-markers={markerPoints.length}
          data-region-chords={chordSegments.length}
          data-chord-colors={chordSegments.map((s) => s.color).join(',')}
          style={{ width: '100%', height: 420 }}
        >
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
              <XAxis dataKey="x" type="number" domain={[0, Math.max(0, maxLen - 1)]} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {regionBands.map((b) => (
                <ReferenceArea key={b.key} x1={b.x1} x2={b.x2} fill={b.color} fillOpacity={0.08} strokeOpacity={0} />
              ))}
              {chordSegments.map((s) => (
                <ReferenceLine
                  key={s.key}
                  segment={[{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  isFront
                />
              ))}
              {markerPoints.map((m) => (
                <ReferenceDot key={m.key} x={m.x} y={m.y} r={4} fill={m.color} stroke="#fff" strokeWidth={1.5} isFront />
              ))}
              {curves.map((c, i) => (
                <Line
                  key={i}
                  type="monotone"
                  dataKey={`c${i}`}
                  name={curveLabel(c, i)}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        </>
      )}
    </div>
  );
}
