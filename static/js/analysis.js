// Analysis explorer: scatter any metric against any other — per 1 km segment
// or per activity — with filters, grouping, binned-median trend lines, a
// second metric (overlaid when it shares Y's unit, else in a linked panel
// below) and an optional colour dimension (sequential scale).
import {
  api, postJson, objects, dataTable, fmtKm, h, fmtDur, fmtDate, TYPE_LABEL, FAMILIES, remember, echart,
  chartTheme, baseAxis, baseTooltip, series, segmented, seqRamp,
  parseTags,
} from './util.js';

// `unit` decides whether two metrics can share one Y axis.
const METRICS = {
  segments: {
    pace:   { label: 'Pace', get: (r) => r.avg_speed, pace: true, unit: 'pace' },
    gap:    { label: 'Grade-adjusted pace', get: (r) => r.avg_gap, pace: true, unit: 'pace' },
    hr:     { label: 'Heart rate (bpm)', get: (r) => r.avg_hr, unit: 'bpm' },
    eff:    { label: 'Efficiency (m per heartbeat)', get: (r) => (r.avg_hr ? (r.avg_gap || r.avg_speed) * 60 / r.avg_hr : null), unit: 'm/beat' },
    grade:  { label: 'Grade (%)', get: (r) => r.grade, unit: '%' },
    ascent: { label: 'Ascent in km (m)', get: (r) => r.ascent, unit: 'm' },
    cad:    { label: 'Cadence (spm)', get: (r) => r.avg_cadence, unit: 'spm' },
    power:  { label: 'Power (W)', get: (r) => r.avg_power, unit: 'W' },
    temp:   { label: 'Temperature (°C)', get: (r) => r.w_temp, unit: '°C' },
    km:     { label: 'Km into activity', get: (r) => r.idx + 1, unit: 'km' },
    year:   { label: 'Year', get: (r) => +r.start_local.slice(0, 4), unit: 'year', int: true },
    date:   { label: 'Date', get: (r) => Date.parse(r.start_local), date: true, unit: 'date' },
  },
  activities: {
    pace:   { label: 'Avg pace', get: (r) => r.avg_moving_speed, pace: true, unit: 'pace' },
    gap:    { label: 'Avg grade-adjusted pace', get: (r) => r.avg_gap_speed, pace: true, unit: 'pace' },
    hr:     { label: 'Avg heart rate (bpm)', get: (r) => r.avg_hr, unit: 'bpm' },
    maxhr:  { label: 'Max heart rate (bpm)', get: (r) => r.max_hr, unit: 'bpm' },
    eff:    { label: 'Efficiency (m per heartbeat)', get: (r) => (r.avg_hr ? (r.avg_gap_speed || r.avg_moving_speed) * 60 / r.avg_hr : null), unit: 'm/beat' },
    apk:    { label: 'Ascent per km (m)', get: (r) => r.ascent_per_km, unit: 'm/km' },
    dist:   { label: 'Distance (km)', get: (r) => (r.distance ? r.distance / 1000 : null), unit: 'km' },
    dur:    { label: 'Moving time (min)', get: (r) => (r.moving_duration ? r.moving_duration / 60 : null), unit: 'min' },
    cad:    { label: 'Cadence', get: (r) => r.avg_cadence, unit: 'spm' },
    power:  { label: 'Power (W)', get: (r) => r.avg_power, unit: 'W' },
    load:   { label: 'Training load', get: (r) => r.training_load, unit: 'load' },
    te:     { label: 'Aerobic TE', get: (r) => r.aerobic_te, unit: 'te' },
    rpe:    { label: 'Perceived effort (RPE 1–10)', get: (r) => r.rpe, unit: 'rpe', int: true },
    feel:   { label: 'Feel (0 very weak … 100 very strong)', get: (r) => r.feel, unit: 'feel', int: true },
    temp:   { label: 'Temperature (°C)', get: (r) => r.w_temp, unit: '°C' },
    hum:    { label: 'Humidity (%)', get: (r) => r.w_humidity, unit: '%' },
    expd:   { label: 'Vs expected pace (s/km, − = faster)', get: (r) => r.exp_delta, unit: 's/km' },
    dec:    { label: 'Aerobic decoupling (%)', get: (r) => r.decoupling, unit: '%' },
    decst:  { label: 'Aerobic decoupling, steady runs only (%)', get: (r) => (r.decoupling_steady ? r.decoupling : null), unit: '%' },
    fit:    { label: 'Fitness: pace at 140 bpm', get: (r) => (r.ref_pace ? 1000 / r.ref_pace : null), pace: true, unit: 'pace' },
    year:   { label: 'Year', get: (r) => +r.start_local.slice(0, 4), unit: 'year', int: true },
    date:   { label: 'Date', get: (r) => Date.parse(r.start_local), date: true, unit: 'date' },
  },
};

// Per-second samples (time-weighted), from the stored HR / speed histograms.
METRICS.samples = {
  hr:   { label: 'Heart rate (bpm)', unit: 'bpm', kind: 'hr', int: true },
  pace: { label: 'Pace', unit: 'pace', kind: 'pace', pace: true },
  gap:  { label: 'Grade-adjusted pace', unit: 'pace', kind: 'gap', pace: true },
};

const state = remember('analysis', {
  level: 'segments', family: 'running', type: '', x: 'hr', y: 'pace', y2: '', color: '', group: 'year',
  from: '', to: '', gradeMin: '', gradeMax: '', apkMax: '', tempMin: '', tempMax: '',
  hrMin: '', hrMax: '', minKm: '', tag: '', trend: true,
  mode: 'scatter', weight: 'count', bins: 40, norm: false,
});

/** plotted value: pace metrics as seconds per km, everything else as-is */
function val(m, r) {
  const v = m.get(r);
  if (v == null || !isFinite(v)) return null;
  if (m.pace) return v > 0.8 ? 1000 / v : null;
  return v;
}
function fmtVal(m, v) {
  v = +v;
  if (v == null || !isFinite(v)) return '–';
  if (m.pace) return fmtDur(v);
  if (m.date) return fmtDate(new Date(v).toISOString());
  if (m.int) return String(Math.round(v));
  const a = Math.abs(v);
  return (+v).toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
const ZOOM_HINT = 'Wheel zooms (over an axis: that axis only; Shift = X, Alt = Y), drag pans, double-click resets.';
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** binned median of y over x-quantile bins (robust against outliers) */
function trend(pts) {
  if (pts.length < 20) return [];
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const nb = Math.min(25, Math.floor(sorted.length / 15));
  const out = [];
  for (let b = 0; b < nb; b++) {
    const chunk = sorted.slice(Math.floor(b * sorted.length / nb), Math.floor((b + 1) * sorted.length / nb));
    const xs = chunk.map((p) => p[0]).sort((p, q) => p - q), ys = chunk.map((p) => p[1]).sort((p, q) => p - q);
    out.push([xs[xs.length >> 1], ys[ys.length >> 1]]);
  }
  return out;
}

export async function analysisPage(app) {
  // URL overrides (bookmarkable views): #/analysis?x=date&y=pace&color=hr
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if ([...q.keys()].length) {
    const patch = {};
    for (const [k, v] of q) patch[k] = v === 'true' ? true : v === 'false' ? false : v;
    state.set(patch);
  }
  const chartEl = h('div', { class: 'chart', style: 'height:600px' });
  let chart = null;
  function newChart() {
    chart?.dispose();
    chart = echart(chartEl);
    chart.on('click', (p) => { if (p.seriesType === 'scatter') location.hash = `#/activity/${p.data[3]}`; });
  }
  newChart();
  let debounce = null;
  const controls = h('div', { class: 'filters' });
  const controls2 = h('div', { class: 'filters' });
  const filters = h('div', { class: 'filters' });
  const info = h('div', { class: 'muted', style: 'margin-top:8px' });
  let data = [];
  let tagsOf = new Map();   // activity id → tags (notes file)

  async function load() {
    const s = state.get();
    info.textContent = 'Loading…';
    if (s.level === 'samples' && s.mode !== 'hist') state.set({ level: 'segments' });
    const acts = objects(await api('activities'));
    tagsOf = new Map(acts.map((r) => [r.id, parseTags(r.tags)]));
    if (state.get().level === 'segments') {
      data = objects(await api(`segments?family=${s.family}`));
    } else {
      data = acts.filter((r) => s.family === 'all' || r.parent_type === s.family);
    }
    buildControls();
    draw();
  }

  const num = (v) => (v === '' || v == null ? null : +v);

  function buildControls() {
    const s = state.get();
    const M = METRICS[s.level];
    for (const k of ['x', 'y']) if (!M[s[k]]) state.set({ [k]: k === 'x' ? 'hr' : 'pace' });
    for (const k of ['y2', 'color']) if (s[k] && !M[s[k]]) state.set({ [k]: '' });
    const sel = (key, opts, val, onchange) => {
      const el = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
      el.addEventListener('change', () => { state.set({ [key]: el.value }); onchange(); });
      return el;
    };
    const types = [...new Set(data.map((r) => r.type_key))].sort();
    const metricOpts = Object.entries(M).map(([k, m]) => [k, m.label]);
    const st = state.get();
    const modeSel = h('label', {}, 'Chart', segmented([['scatter', 'Scatter'], ['hist', 'Histogram']], st.mode, (v) => {
      state.set({ mode: v });
      if (v !== 'hist' && state.get().level === 'samples') state.set({ level: 'segments' });
      load();
    }));
    if (st.mode === 'hist') {
      const levels = [['segments', '1 km segments'], ['activities', 'Activities'], ['samples', 'All samples']];
      const binsEl = h('input', { type: 'number', min: 5, max: 200, step: 5, value: st.bins, style: 'width:70px' });
      binsEl.addEventListener('input', () => { state.set({ bins: binsEl.value }); clearTimeout(debounce); debounce = setTimeout(draw, 300); });
      controls.replaceChildren(...[
        modeSel,
        h('label', {}, 'Level', segmented(levels, st.level, (v) => { state.set({ level: v }); load(); })),
        h('label', {}, 'Sport', sel('family', [['all', 'all'], ...FAMILIES.map((f) => [f, f])], st.family, load)),
        h('label', {}, 'Value', sel('x', metricOpts, st.x, draw)),
        st.level !== 'samples'
          ? h('label', {}, 'Weight', segmented([['count', 'count'], ['time', 'moving time'], ['distance', 'distance']], st.weight, (v) => { state.set({ weight: v }); draw(); }))
          : h('label', {}, 'Weight', h('span', { class: 'sub', style: 'padding:6px 0' }, 'time (per-second samples)')),
        h('label', {}, 'Bins', binsEl),
        h('label', {}, 'Show', segmented([[false, 'totals'], [true, '% within group']], st.norm, (v) => { state.set({ norm: v }); draw(); })),
      ].filter(Boolean));
      controls2.replaceChildren(
        h('label', {}, 'Group by', sel('group', [['none', 'nothing'], ['year', 'year'], ['type', 'activity type'], ['temp', 'temperature band']], st.group, draw)));
      buildFilters(st, sel, types);
      return;
    }
    controls.replaceChildren(
      modeSel,
      h('label', {}, 'Level', segmented([['segments', '1 km segments'], ['activities', 'Activities']], st.level, (v) => { state.set({ level: v }); load(); })),
      h('label', {}, 'Sport', sel('family', [['all', 'all'], ...FAMILIES.map((f) => [f, f])], st.family, load)),
      h('label', {}, 'X', sel('x', metricOpts, st.x, draw)),
      h('label', {}, 'Y', sel('y', metricOpts, st.y, () => { buildControls(); draw(); })),
      h('label', {}, 'Second Y', sel('y2', [['', '—'], ...metricOpts], st.y2, () => { buildControls(); draw(); })),
      h('label', {}, 'Colour by', sel('color', [['', 'group (below)'], ...metricOpts], st.color, () => { buildControls(); draw(); })),
    );
    const groupSel = sel('group', [['none', 'nothing'], ['year', 'year'], ['type', 'activity type'], ['temp', 'temperature band']], st.group, draw);
    const overlay = st.y2 && st.y2 !== st.y && M[st.y2].unit === M[st.y].unit;
    const groupBlocked = st.color ? 'Colour already encodes a metric'
      : overlay ? 'Colour distinguishes the two overlaid metrics' : null;
    if (groupBlocked) groupSel.disabled = true;
    controls2.replaceChildren(
      h('label', { title: groupBlocked }, 'Group by', groupSel),
      h('label', {}, 'Trend', segmented([[true, 'binned median'], [false, 'off']], st.trend, (v) => { state.set({ trend: v }); draw(); })),
    );
    buildFilters(st, sel, types);
  }

  function buildFilters(st, sel, types) {
    const inp = (key, ph, step = '1') => {
      const el = h('input', { type: 'number', step, placeholder: ph, value: state.get()[key] });
      el.addEventListener('input', () => {
        state.set({ [key]: el.value });
        clearTimeout(debounce);
        debounce = setTimeout(draw, 300);   // don't redraw on half-typed numbers
      });
      return el;
    };
    const date = (key) => {
      const el = h('input', { type: 'date', value: state.get()[key] });
      el.addEventListener('change', () => { state.set({ [key]: el.value }); draw(); });
      return el;
    };
    filters.replaceChildren(...[
      h('label', {}, 'Type', sel('type', [['', 'any'], ...types.map((t) => [t, TYPE_LABEL(t)])], st.type, draw)),
      h('label', {}, 'From', date('from')), h('label', {}, 'To', date('to')),
      st.level === 'segments' ? h('label', {}, 'Segment grade %', h('span', {}, inp('gradeMin', 'min', '0.5'), ' – ', inp('gradeMax', 'max', '0.5'))) : null,
      h('label', {}, 'Activity ascent/km ≤', inp('apkMax', 'm/km')),
      h('label', {}, 'Temp °C', h('span', {}, inp('tempMin', 'min'), ' – ', inp('tempMax', 'max'))),
      h('label', {}, st.level === 'segments' ? 'HR' : 'Activity avg HR', h('span', {}, inp('hrMin', 'min'), ' – ', inp('hrMax', 'max'))),
      h('label', {}, 'Activity ≥ km', inp('minKm', 'km', '0.5')),
      (() => {
        const ct = new Map();
        for (const ts of tagsOf.values()) for (const t of ts) ct.set(t, (ct.get(t) || 0) + 1);
        if (!ct.size) return null;
        const opts = [['', 'any'], ...[...ct.entries()].sort((a, b) => b[1] - a[1]).flatMap(([t]) => [[t, t], [`-${t}`, `without ${t}`]])];
        return h('label', {}, 'Tag', sel('tag', opts, st.tag, draw));
      })(),
    ].filter(Boolean));
  }

  function filteredRows() {
    const s = state.get();
    const seg = s.level === 'segments';
    const totalDist = (r) => (seg ? r.total_distance : r.distance);
    return data.filter((r) =>
      (!s.type || r.type_key === s.type) &&
      (!s.from || r.start_local >= s.from) &&
      (!s.to || r.start_local.slice(0, 10) <= s.to) &&
      (!seg || num(s.gradeMin) == null || (r.grade != null && r.grade >= num(s.gradeMin))) &&
      (!seg || num(s.gradeMax) == null || (r.grade != null && r.grade <= num(s.gradeMax))) &&
      (num(s.apkMax) == null || (r.ascent_per_km != null && r.ascent_per_km <= num(s.apkMax))) &&
      (num(s.tempMin) == null || (r.w_temp != null && r.w_temp >= num(s.tempMin))) &&
      (num(s.tempMax) == null || (r.w_temp != null && r.w_temp <= num(s.tempMax))) &&
      (num(s.hrMin) == null || (r.avg_hr != null && r.avg_hr >= num(s.hrMin))) &&
      (num(s.hrMax) == null || (r.avg_hr != null && r.avg_hr <= num(s.hrMax))) &&
      (num(s.minKm) == null || (totalDist(r) || 0) >= num(s.minKm) * 1000) &&
      (!s.tag || (() => { const ts = tagsOf.get(seg ? r.activity_id : r.id) || [];
        return s.tag.startsWith('-') ? !ts.includes(s.tag.slice(1)) : ts.includes(s.tag); })()));
  }

  function draw() {
    if (state.get().mode === 'hist') {
      drawHist().catch((e) => { console.error(e); info.textContent = 'Error: ' + e.message; });
      return;
    }
    statsEl.replaceChildren();
    const s = state.get();
    const M = METRICS[s.level];
    const seg = s.level === 'segments';
    const X = M[s.x], Y = M[s.y];
    const Y2 = s.y2 && s.y2 !== s.y ? M[s.y2] : null;
    const C = s.color ? M[s.color] : null;
    const overlay = !!Y2 && Y2.unit === Y.unit;
    const twoPanels = !!Y2 && !overlay;
    const th = chartTheme();
    const ramp = seqRamp();

    // point = [x, y, c, activityId, name, start_local, segIdx]
    const ptsY = [], ptsY2 = [];
    for (const r of filteredRows()) {
      const x = val(X, r);
      if (x == null) continue;
      const c = C ? val(C, r) : null;
      if (C && c == null) continue;
      const base = [r.activity_id ?? r.id, r.name, r.start_local, r.idx];
      const y = val(Y, r);
      if (y != null) ptsY.push([x, y, c, ...base]);
      if (Y2) { const y2 = val(Y2, r); if (y2 != null) ptsY2.push([x, y2, c, ...base]); }
    }
    // with a colour scale, draw high values last so e.g. the newest points sit on top
    if (C) { ptsY.sort((a, b) => a[2] - b[2]); ptsY2.sort((a, b) => a[2] - b[2]); }

    // ── grouping (only without a colour metric and without an overlay) ──
    const useGroups = !C && !overlay && s.group !== 'none';
    const groupOf = (p) => {
      const iso = p[5];
      if (s.group === 'year') return iso.slice(0, 4);
      if (s.group === 'type' || s.group === 'temp') {
        const r = rowById.get(p[3] + ':' + (p[6] ?? ''));
        if (s.group === 'type') return TYPE_LABEL(r?.type_key);
        if (r?.w_temp == null) return 'unknown';
        const b = Math.floor(r.w_temp / 5) * 5;
        return `${b}–${b + 5} °C`;
      }
      return 'all';
    };
    const rowById = new Map(data.map((r) => [(r.activity_id ?? r.id) + ':' + (r.idx ?? ''), r]));
    const groupNames = (() => {
      if (!useGroups) return ['all'];
      const set = new Set([...ptsY, ...ptsY2].map(groupOf));
      let names = [...set].sort();
      if (s.group === 'temp') names.sort((a, b) => parseFloat(a) - parseFloat(b));
      return names;
    })();
    const ordered = s.group === 'year' || s.group === 'temp';
    let names = groupNames;
    let foldOther = null;
    if (useGroups && !ordered && names.length > 8) {
      // never invent a 9th hue: keep the 7 biggest, fold the rest
      const counts = new Map();
      for (const p of ptsY) counts.set(groupOf(p), (counts.get(groupOf(p)) || 0) + 1);
      const keep = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map((e) => e[0]));
      foldOther = keep;
      names = [...keep].sort().concat(['other']);
    }
    const groupKey = (p) => {
      if (!useGroups) return 'all';
      const g = groupOf(p);
      return foldOther && !foldOther.has(g) ? 'other' : g;
    };
    const groupColor = (i) => {
      if (!useGroups) return null;
      if (!ordered) return series(i);
      const steps = ramp;
      if (names.length === 1) return steps[steps.length - 1];
      return steps[Math.round(i * (steps.length - 1) / (names.length - 1))];
    };

    // ── series ──
    const seriesList = [];
    const scatterIdx = [];
    const addScatter = (pts, metric, panel, color, symbol, name, key) => {
      scatterIdx.push(seriesList.length);
      seriesList.push({
        id: `${key}:${name}`, name, type: 'scatter', xAxisIndex: panel, yAxisIndex: panel,
        large: !C && pts.length > 4000, symbol, symbolSize: seg ? (symbol === 'circle' ? 5 : 6) : 8,
        itemStyle: color ? { color, opacity: s.trend ? 0.35 : 0.7 } : { opacity: s.trend ? 0.55 : 0.85 },
        data: pts,
      });
    };
    const addTrend = (pts, panel, color, name) => {
      if (!s.trend) return;
      seriesList.push({
        name, type: 'line', xAxisIndex: panel, yAxisIndex: panel, symbol: 'circle', symbolSize: 6, smooth: 0.3,
        lineStyle: { width: 2.5, color }, itemStyle: { color, borderColor: th.surface, borderWidth: 2 },
        data: trend(pts), z: 10, tooltip: { show: false },
      });
    };
    const panelOfY2 = twoPanels ? 1 : 0;
    const legendNames = [];
    if (C) {
      // colour = third variable; trend lines in ink (one per metric)
      const yName = Y2 ? Y.label : 'points';
      addScatter(ptsY, Y, 0, null, 'circle', yName, 'y');
      addTrend(ptsY, 0, th.ink, yName);
      if (Y2) {
        addScatter(ptsY2, Y2, panelOfY2, null, overlay ? 'triangle' : 'circle', Y2.label, 'y2');
        addTrend(ptsY2, panelOfY2, overlay ? th.ink2 : th.ink, Y2.label);
        if (overlay) legendNames.push(Y.label, Y2.label);
      }
    } else if (overlay) {
      // two metrics, same unit → one panel, two colours
      addScatter(ptsY, Y, 0, series(0), 'circle', Y.label, 'y');
      addTrend(ptsY, 0, series(0), Y.label);
      addScatter(ptsY2, Y2, 0, series(1), 'circle', Y2.label, 'y2');
      addTrend(ptsY2, 0, series(1), Y2.label);
      legendNames.push(Y.label, Y2.label);
    } else {
      const byGroup = (pts) => {
        const m = new Map(names.map((n) => [n, []]));
        for (const p of pts) m.get(groupKey(p))?.push(p);
        return m;
      };
      const gy = byGroup(ptsY), gy2 = Y2 ? byGroup(ptsY2) : null;
      names.forEach((n, i) => {
        const color = useGroups ? groupColor(i) : series(0);
        addScatter(gy.get(n), Y, 0, color, 'circle', n, 'y');
        addTrend(gy.get(n), 0, color, n);
        if (gy2) {
          const c2 = useGroups ? color : series(1);
          addScatter(gy2.get(n), Y2, 1, c2, 'circle', n, 'y2');
          addTrend(gy2.get(n), 1, c2, n);
        }
      });
      if (useGroups) legendNames.push(...names);
    }

    // ── colour scale ──
    let visualMap = undefined;
    if (C) {
      const cs = [...ptsY, ...ptsY2].map((p) => p[2]).sort((a, b) => a - b);
      const distinct = [...new Set(cs.map((v) => +v.toPrecision(8)))];
      const colors = C.pace ? [...ramp].reverse() : ramp;   // pace: faster = the scale's "high" end
      const common = {
        dimension: 2, seriesIndex: scatterIdx, orient: 'vertical', right: 8, top: 'middle',
        textStyle: { color: th.ink2, fontSize: 11 }, itemWidth: 14,
      };
      if (distinct.length <= 8 && !C.date) {
        const steps = distinct.length === 1 ? [colors[colors.length - 1]]
          : distinct.map((_, i) => colors[Math.round(i * (colors.length - 1) / (distinct.length - 1))]);
        visualMap = {
          ...common, type: 'piecewise',
          categories: distinct,
          inRange: { color: steps },
          formatter: (v) => fmtVal(C, +v),
        };
        // piecewise categories match by value → order colours to categories
        visualMap.pieces = distinct.map((v, i) => ({ value: v, color: steps[i], label: fmtVal(C, v) }));
        delete visualMap.categories;
        delete visualMap.inRange;
      } else {
        const lo = quantile(cs, 0.02), hi = quantile(cs, 0.98);
        visualMap = {
          ...common, type: 'continuous', min: lo, max: hi > lo ? hi : lo + 1, calculable: true,
          precision: 2, itemHeight: twoPanels ? 260 : 200,
          inRange: { color: colors },
          formatter: (v) => fmtVal(C, v),
        };
      }
    }

    // ── axes / layout ──
    const robust = (m, pts) => {
      if (!m.pace || !pts.length) return {};
      const vs = pts.map((p) => p[1]).sort((a, b) => a - b);
      return { min: Math.floor((quantile(vs, 0.005) - 10) / 10) * 10, max: Math.ceil((quantile(vs, 0.995) + 10) / 10) * 10 };
    };
    const robustX = () => {
      if (!X.pace) return {};
      const vs = [...ptsY, ...ptsY2].map((p) => p[0]).sort((a, b) => a - b);
      if (!vs.length) return {};
      return { min: Math.floor((quantile(vs, 0.005) - 10) / 10) * 10, max: Math.ceil((quantile(vs, 0.995) + 10) / 10) * 10 };
    };
    const rightPad = C ? 110 : 30;
    const panelCount = twoPanels ? 2 : 1;
    chartEl.style.height = twoPanels ? '820px' : '600px';
    chart.resize();
    const grids = twoPanels
      ? [{ left: 70, right: rightPad, top: 40, height: '40%' }, { left: 70, right: rightPad, top: '54%', bottom: 60 }]
      : [{ left: 70, right: rightPad, top: 40, bottom: 60 }];
    const xAxes = grids.map((_, i) => ({
      gridIndex: i, type: X.date ? 'time' : 'value', scale: true, inverse: !!X.pace, ...robustX(), ...baseAxis(th),
      name: i === panelCount - 1 ? X.label : '', nameLocation: 'middle', nameGap: 32,
      axisLabel: { ...baseAxis(th).axisLabel, show: i === panelCount - 1, formatter: X.date ? undefined : (v) => fmtVal(X, v) },
    }));
    const yMetric = (i) => (i === 0 ? (overlay ? Y : Y) : Y2);
    const yAxes = grids.map((_, i) => {
      const m = yMetric(i);
      const pts = i === 0 ? (overlay ? [...ptsY, ...ptsY2] : ptsY) : ptsY2;
      return {
        gridIndex: i, type: m.date ? 'time' : 'value', scale: true, inverse: !!m.pace, ...robust(m, pts), ...baseAxis(th),
        name: overlay && i === 0 ? `${Y.label} / ${Y2.label}` : m.label, nameLocation: 'middle', nameGap: 52,
        axisLabel: { ...baseAxis(th).axisLabel, formatter: m.date ? undefined : (v) => fmtVal(m, v) },
      };
    });

    const npts = ptsY.length;
    if (npts + ptsY2.length === 0) {
      chart.clear();
      chart.setOption({ title: { text: 'No points match the current filters', left: 'center', top: 'middle',
        textStyle: { color: th.muted, fontSize: 14, fontWeight: 'normal' } } }, true);
      info.textContent = '0 points shown.';
      return;
    }
    info.textContent = `${npts} ${seg ? 'segments' : 'activities'} shown. ` +
      (s.trend ? 'Lines: median of Y within X-quantile bins. ' : '') +
      (C && visualMap?.type === 'continuous' ? 'Drag the colour bar handles to filter by colour. ' : '') +
      'Click a point to open the activity. ' + ZOOM_HINT;

    const option = {
      animation: false,
      grid: grids,
      legend: legendNames.length ? { top: 0, type: 'scroll', textStyle: { color: th.ink2 }, data: legendNames } : { show: false },
      axisPointer: twoPanels ? { link: [{ xAxisIndex: 'all' }] } : undefined,
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => {
        const d = p.data;
        const isY2 = String(p.seriesId).startsWith('y2');
        const m = isY2 ? Y2 : Y;
        const r = rowById.get(d[3] + ':' + (d[6] ?? ''));
        let extra = '';
        if (Y2 && r) { const o = isY2 ? Y : Y2; extra = `<br>${o.label}: ${fmtVal(o, val(o, r))}`; }
        return `<b>${d[4] || ''}</b><br>${fmtDate(d[5])}${seg ? ` · km ${d[6] + 1}` : ''}<br>` +
          `${X.label}: ${fmtVal(X, d[0])}<br>${m.label}: ${fmtVal(m, d[1])}${extra}` +
          (C ? `<br>${C.label}: ${fmtVal(C, d[2])}` : '');
      } },
      xAxis: xAxes,
      yAxis: yAxes,
      visualMap,
      dataZoom: [{ type: 'inside', xAxisIndex: grids.map((_, i) => i) },
                 ...grids.map((_, i) => ({ type: 'inside', yAxisIndex: i }))],
      series: seriesList,
    };
    try {
      chart.setOption(option, true);
    } catch (e) {
      // a failed setOption leaves ECharts half-updated; start from a fresh instance
      console.error('analysis chart:', e);
      newChart();
      try { chart.setOption(option, true); } catch (e2) { info.textContent = 'Chart error: ' + e2.message; }
    }
  }

  // ── histogram ──
  const statsEl = h('div', { style: 'margin-top:12px' });
  function groupOfRow(r, group) {
    if (group === 'year') return r.start_local.slice(0, 4);
    if (group === 'type') return TYPE_LABEL(r.type_key);
    if (group === 'temp') {
      if (r.w_temp == null) return 'unknown';
      const b = Math.floor(r.w_temp / 5) * 5;
      return `${b}–${b + 5} °C`;
    }
    return 'all';
  }
  function niceStep(raw, pace) {
    if (pace) return [1, 2, 5, 10, 15, 20, 30, 60, 120].find((x) => x >= raw) ?? 120;
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((m) => m * e).find((x) => x >= raw);
  }
  function wQuantile(sorted, q) {   // sorted [[v, w]], weighted quantile
    const tot = sorted.reduce((a, p) => a + p[1], 0);
    let acc = 0;
    for (const [v, w] of sorted) { acc += w; if (acc >= q * tot) return v; }
    return sorted.length ? sorted[sorted.length - 1][0] : null;
  }

  async function drawHist() {
    const s = state.get();
    const M = METRICS[s.level];
    const X = M[s.x] || Object.values(M)[0];
    const th = chartTheme();
    const rows = filteredRows();
    // values: [value, weight, group]
    let vals = [];
    const groupNamesSet = new Set();
    if (s.level === 'samples') {
      const groups = {};
      for (const r of rows) {
        const g = groupOfRow(r, s.group);
        (groups[g] ??= []).push(r.id);
      }
      info.textContent = 'Loading samples…';
      const res = await postJson('hist', { kind: X.kind, groups });
      for (const [g, buckets] of Object.entries(res)) {
        for (const [b, secs] of buckets) {
          let v = b;
          if (X.pace) { const sp = b * 0.05; if (sp < 0.8) continue; v = 1000 / sp; }
          if (secs > 0) vals.push([v, secs, g]);
        }
      }
    } else {
      const seg = s.level === 'segments';
      const wOf = (r) => s.weight === 'time' ? (seg ? r.time : r.moving_duration)
        : s.weight === 'distance' ? (seg ? r.length : r.distance) : 1;
      for (const r of rows) {
        const v = val(X, r), w = wOf(r);
        if (v == null || !(w > 0)) continue;
        vals.push([v, w, groupOfRow(r, s.group)]);
      }
    }
    if (!vals.length) {
      chart.clear();
      chart.setOption({ title: { text: 'No data match the current filters', left: 'center', top: 'middle',
        textStyle: { color: th.muted, fontSize: 14, fontWeight: 'normal' } } }, true);
      info.textContent = '0 values.'; statsEl.replaceChildren();
      return;
    }
    for (const v of vals) groupNamesSet.add(v[2]);
    // groups: ordered (year/temp) → continuous scale; nominal → categorical, fold > 8
    let names = [...groupNamesSet].sort();
    if (s.group === 'temp') names.sort((a, b) => parseFloat(a) - parseFloat(b));
    const ordered = s.group === 'year' || s.group === 'temp';
    if (!ordered && names.length > 8) {
      const tot = new Map();
      for (const [, w, g] of vals) tot.set(g, (tot.get(g) || 0) + w);
      const keep = new Set([...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map((e) => e[0]));
      vals = vals.map((v) => (keep.has(v[2]) ? v : [v[0], v[1], 'other']));
      names = [...keep].sort().concat(['other']);
    }
    const ramp = seqRamp();
    const colorOf = (i) => (names.length === 1 ? series(0) : !ordered ? series(i)
      : ramp[Math.round(i * (ramp.length - 1) / (names.length - 1))]);

    // bins over the weighted 0.5–99.5 % range
    const sorted = vals.map((v) => [v[0], v[1]]).sort((a, b) => a[0] - b[0]);
    const lo = wQuantile(sorted, 0.005), hi = wQuantile(sorted, 0.995);
    const nb = Math.max(5, Math.min(200, +s.bins || 40));
    const step = niceStep(Math.max((hi - lo) / nb, X.int ? 1 : 1e-9), X.pace);
    const start = Math.floor(lo / step) * step;
    const nBins = Math.max(1, Math.floor((hi - start) / step) + 1);
    const counts = new Map(names.map((n) => [n, new Array(nBins).fill(0)]));
    let clipped = 0;
    for (const [v, w, g] of vals) {
      const i = Math.floor((v - start) / step);
      if (i < 0 || i >= nBins) { clipped += w; continue; }
      counts.get(g)[i] += w;
    }
    // pace: slow on the left, fast on the right (as on the scatter axes)
    const order = [...Array(nBins).keys()];
    if (X.pace) order.reverse();
    const edge = (i) => start + i * step;
    const catLabel = (i) => fmtVal(X, edge(i));
    const rangeLabel = (i) => (X.pace ? `${fmtVal(X, edge(i) + step)}–${fmtVal(X, edge(i))}` : `${fmtVal(X, edge(i))}–${fmtVal(X, edge(i) + step)}`);
    const isTime = s.level === 'samples' || s.weight === 'time';
    const isDist = s.level !== 'samples' && s.weight === 'distance';
    const fmtW = (w) => (s.norm ? `${(+w).toFixed(1)}%` : isTime ? fmtDur(w) : isDist ? `${fmtKm(w, 1)} km` : String(Math.round(w)));
    const axisW = (w) => (s.norm ? `${w}%` : isTime ? `${+(w / 3600).toFixed(1)} h` : isDist ? `${+(w / 1000).toFixed(0)} km` : w);
    const yName = s.norm ? '% of group' : isTime ? 'Time' : isDist ? 'Distance' : 'Count';

    const seriesList = names.map((n, k) => {
      const c = counts.get(n);
      const tot = c.reduce((a, b) => a + b, 0) || 1;
      const data = order.map((i) => (s.norm ? 100 * c[i] / tot : c[i]));
      const color = colorOf(k);
      return s.norm && names.length > 1
        ? { name: n, type: 'line', step: 'middle', symbol: 'none', data, lineStyle: { width: 2, color }, itemStyle: { color } }
        : { name: n, type: 'bar', stack: 'h', data, barCategoryGap: '8%',
            itemStyle: { color, borderColor: th.surface, borderWidth: names.length > 1 ? 1 : 0 } };
    });
    // per-group stats (weighted)
    const statRows = names.map((n) => {
      const vs = vals.filter((v) => v[2] === n).map((v) => [v[0], v[1]]).sort((a, b) => a[0] - b[0]);
      const tw = vs.reduce((a, p) => a + p[1], 0);
      const mean = vs.reduce((a, p) => a + p[0] * p[1], 0) / (tw || 1);
      return { group: n, n: vs.length, weight: tw, mean, p10: wQuantile(vs, 0.1), median: wQuantile(vs, 0.5), p90: wQuantile(vs, 0.9) };
    });
    // single group: mark the weighted median
    if (names.length === 1) {
      const med = statRows[0].median;
      const mi = Math.min(nBins - 1, Math.max(0, Math.floor((med - start) / step)));
      seriesList[0].markLine = { symbol: 'none', silent: true, lineStyle: { color: th.ink, width: 1.5, type: 'solid' },
        label: { formatter: `median ${fmtVal(X, med)}`, color: th.ink2 }, data: [{ xAxis: catLabel(mi) }] };
    }
    const option = {
      animation: false,
      grid: { left: 70, right: 30, top: 40, bottom: 60 },
      legend: names.length > 1 ? { top: 0, type: 'scroll', textStyle: { color: th.ink2 }, data: names } : { show: false },
      tooltip: { ...baseTooltip(th), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => {
        const i = order[ps[0].dataIndex];
        return `<b>${X.label}: ${rangeLabel(i)}</b><br>` + ps.filter((p) => p.value > 0).map((p) => `${p.marker}${p.seriesName}: ${fmtW(p.value)}`).join('<br>');
      } },
      xAxis: { type: 'category', data: order.map(catLabel), name: X.label, nameLocation: 'middle', nameGap: 32,
        ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 52, ...baseAxis(th),
        axisLabel: { ...baseAxis(th).axisLabel, formatter: axisW } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series: seriesList,
    };
    chartEl.style.height = '600px';
    chart.resize();
    try { chart.setOption(option, true); }
    catch (e) { console.error(e); newChart(); chart.setOption(option, true); }
    const totalW = vals.reduce((a, v) => a + v[1], 0);
    info.textContent = `${s.level === 'samples' ? `${rows.length} activities, ` : ''}bin width ${X.pace || X.unit === 'bpm' ? fmtVal(X, step).replace(/^0:/, '') + (X.pace ? ' s' : '') : step}` +
      (clipped > 0 ? ` · ${(100 * clipped / totalW).toFixed(1)}% outside the shown range (0.5–99.5 % quantiles)` : '') + '. ' + ZOOM_HINT;
    statsEl.replaceChildren(dataTable(statRows, [
      { key: 'group', label: 'Group', left: true, defaultAsc: true },
      s.level !== 'samples' && isTime || isDist ? { key: 'n', label: 'N' } : null,
      { key: 'weight', label: isTime ? 'Time' : isDist ? 'Distance' : 'Count', fmt: (v) => (isTime ? fmtDur(v) : isDist ? `${fmtKm(v, 1)} km` : String(Math.round(v))) },
      { key: 'mean', label: 'Mean', fmt: (v) => fmtVal(X, v) },
      { key: 'p10', label: 'P10', fmt: (v) => fmtVal(X, v) },
      { key: 'median', label: 'Median', fmt: (v) => fmtVal(X, v) },
      { key: 'p90', label: 'P90', fmt: (v) => fmtVal(X, v) },
    ].filter(Boolean), { sortKey: 'group', sortDesc: false, pageSize: 50 }));
  }

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Analysis'),
      h('span', { class: 'sub' }, 'e.g. X: date, Y: pace, colour: heart rate — or X: pace, Y: heart rate, colour: date.')),
    controls, controls2, filters, h('div', { class: 'card' }, chartEl, info, statsEl));
  await load();
  return () => chart?.dispose();
}
