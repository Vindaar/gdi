// Shared helpers: data access, formatting, small UI components.

const cache = new Map();

export async function api(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const p = fetch('api/' + path).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json();
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}
export function clearCache() { cache.clear(); }

export async function postJson(path, body) {
  const r = await fetch('api/' + path, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  clearCache();
  return r.json();
}

/** {cols, rows} → array of objects */
export function objects(t) {
  return t.rows.map((r) => {
    const o = {};
    t.cols.forEach((c, i) => (o[c] = r[i]));
    return o;
  });
}

// ── formatting ──────────────────────────────────────────────────────────────

const isNum = (x) => typeof x === 'number' && isFinite(x);
export const pad2 = (n) => String(n).padStart(2, '0');

export function fmtDur(s) {
  if (!isNum(s)) return '–';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}
/** m/s → "m:ss" per km */
export function fmtPace(v) {
  if (!isNum(v) || v <= 0.2) return '–';
  return fmtDur(1000 / v);
}
export const fmtKm = (m, d = 2) => (isNum(m) ? (m / 1000).toFixed(d) : '–');
export const fmtKmh = (v) => (isNum(v) ? (v * 3.6).toFixed(1) : '–');
export const fmtNum = (x, d = 0) => (isNum(x) ? x.toFixed(d) : '–');
export function fmtDate(iso, withTime = false) {
  if (!iso) return '–';
  const d = iso.slice(0, 10);
  return withTime ? `${d} ${iso.slice(11, 16)}` : d;
}
export function fmtDistanceLabel(m) {
  const named = { 1609.344: '1 mi', 21097.5: 'Half', 42195: 'Marathon', 160934.4: '100 mi' };
  if (named[m]) return named[m];
  return m < 1000 ? `${m} m` : `${+(m / 1000).toFixed(3)} km`;
}

/** pace or speed depending on sport family */
export function usesPace(family) { return family === 'running' || family === 'walking' || family === 'swimming'; }
export function fmtSpeedFor(family, v) { return usesPace(family) ? fmtPace(v) : fmtKmh(v); }
export function speedUnit(family) { return usesPace(family) ? '/km' : 'km/h'; }

export const FAMILIES = ['running', 'cycling', 'walking', 'swimming', 'fitness', 'climbing', 'other'];
export const TYPE_LABEL = (k) => (k || '').replace(/_v2$|_ws$/, '').replace(/_/g, ' ');

// ── theme colours (read from CSS tokens so dark mode follows) ──────────────

export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export const series = (i) => css(`--s${(i % 8) + 1}`);
export const zoneColor = (z) => css(`--z${z}`);
export function chartTheme() {
  return { ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), grid: css('--grid'),
           axis: css('--axis'), surface: css('--surface'), accent: css('--accent') };
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const tip = () => document.getElementById('tooltip');
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(x + 14, window.innerWidth - r.width - 8) + 'px';
  t.style.top = Math.min(y + 14, window.innerHeight - r.height - 8) + 'px';
}
export function hideTip() { tip().hidden = true; }

export function tile(label, value, unit = '') {
  return h('div', { class: 'tile' }, h('div', { class: 'k' }, label),
    h('div', { class: 'v' }, value, unit ? h('span', { class: 'u' }, unit) : null));
}

/**
 * Sortable, paged table.
 * columns: [{key, label, fmt?(v,row), sortVal?(row), left?, cls?, link?(row), after?(row)}]
 *   (`after` adds an unlinked element behind the cell content, e.g. a badge)
 */
const PAGE_SIZES = [25, 50, 100, 250, 500, 0];   // 0 = all

export function dataTable(rows, columns, { sortKey, sortDesc = true, pageSize = 100, onSort, id } = {}) {
  let key = sortKey ?? columns[0].key, desc = sortDesc, page = 0;
  // per-table page size, remembered when the table has an `id`
  const sizeKey = id ? 'gdi:pageSize:' + id : null;
  try { const v = sizeKey && localStorage.getItem(sizeKey); if (v != null && v !== '') pageSize = +v; } catch {}
  const wrap = h('div', { class: 'table-wrap' });
  const pager = h('div', { class: 'pager' });
  const root = h('div', {}, wrap, pager);

  function sorted() {
    const col = columns.find((c) => c.key === key);
    const val = col?.sortVal ?? ((r) => r[key]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return desc ? -c : c;
    });
  }
  function render() {
    const all = sorted();
    const per = pageSize > 0 ? pageSize : Math.max(1, all.length);
    const pages = Math.max(1, Math.ceil(all.length / per));
    page = Math.min(page, pages - 1);
    const slice = all.slice(page * per, (page + 1) * per);
    const thead = h('thead', {}, h('tr', {}, columns.map((c) =>
      h('th', {
        class: [c.left ? 'l' : '', c.key === key ? 'sorted' : '', c.key === key && !desc ? 'asc' : ''].join(' '),
        onclick: () => {
          if (key === c.key) desc = !desc; else { key = c.key; desc = c.defaultAsc ? false : true; }
          onSort?.(key, desc);
          render();
        },
      }, c.label))));
    const tbody = h('tbody', {}, slice.map((r, i) => h('tr', {}, columns.map((c) => {
      const raw = c.fmt ? c.fmt(r[c.key], r, page * per + i) : r[c.key] ?? '–';
      const content = c.link ? h('a', { href: c.link(r) }, raw) : raw;
      const extra = c.after ? c.after(r) : null;
      return h('td', { class: [c.left ? 'l' : '', c.cls || ''].join(' '), title: c.title ? c.title(r) : null },
        content, extra ? ' ' : null, extra);
    }))));
    wrap.replaceChildren(h('table', { class: 'data' }, thead, tbody));
    pager.replaceChildren(...[
      h('span', {}, `${all.length} rows`),
      pages > 1 ? h('button', { onclick: () => { page = Math.max(0, page - 1); render(); }, disabled: page === 0 }, '‹') : null,
      pages > 1 ? h('span', {}, `page ${page + 1} / ${pages}`) : null,
      pages > 1 ? h('button', { onclick: () => { page = Math.min(pages - 1, page + 1); render(); }, disabled: page >= pages - 1 }, '›') : null,
      all.length > PAGE_SIZES[0] ? sizeSelect() : null,
    ].filter(Boolean));
  }
  function sizeSelect() {
    const sizes = PAGE_SIZES.includes(pageSize) ? PAGE_SIZES : [...PAGE_SIZES, pageSize].sort((a, b) => (a || 1e9) - (b || 1e9));
    const sel = h('select', {}, sizes.map((n) => h('option', { value: n, selected: n === pageSize }, n === 0 ? 'all' : n)));
    sel.addEventListener('change', () => {
      const first = page * (pageSize || 1e9);       // keep the first visible row in view
      pageSize = +sel.value;
      page = pageSize > 0 ? Math.floor(first / pageSize) : 0;
      try { if (sizeKey) localStorage.setItem(sizeKey, String(pageSize)); } catch {}
      render();
    });
    return h('label', { style: 'margin-left:auto;display:flex;gap:6px;align-items:center' }, 'rows per page', sel);
  }
  render();
  root.update = (newRows) => { rows = newRows; page = 0; render(); };
  return root;
}

/** segmented control */
export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const draw = () => el.replaceChildren(...options.map(([v, label]) =>
    h('button', { class: v === value ? 'on' : '', onclick: () => { value = v; draw(); onChange(v); } }, label)));
  draw();
  return el;
}

/** persist small UI state per page (best-effort) */
export function remember(key, initial) {
  let v = initial;
  try { const s = localStorage.getItem('gdi:' + key); if (s) v = { ...initial, ...JSON.parse(s) }; } catch {}
  return {
    get: () => v,
    set: (patch) => { v = { ...v, ...patch }; try { localStorage.setItem('gdi:' + key, JSON.stringify(v)); } catch {} },
  };
}

/** ECharts instance with resize handling + base theme */
export function echart(el) {
  const c = echarts.init(el, null, { renderer: 'canvas' });
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  // Built-in wheel zoom always zooms every axis of a dataZoom at once; we
  // disable it and route the wheel through `axisWheelZoom` instead.
  const setOption = c.setOption.bind(c);
  c.setOption = (opt, ...rest) => {
    if (opt && opt.dataZoom) {
      const dzs = Array.isArray(opt.dataZoom) ? opt.dataZoom : [opt.dataZoom];
      for (const dz of dzs) if (dz.type === 'inside') dz.zoomOnMouseWheel = false;
    }
    return setOption(opt, ...rest);
  };
  axisWheelZoom(c);
  return c;
}

/**
 * Wheel zoom per axis:
 *   wheel in the plot   → both axes (Shift: X only, Alt: Y only)
 *   wheel over an axis  → that axis only
 *   double-click        → reset all zoom
 * Zooms around the cursor. Only axes that have a dataZoom are zoomable.
 */
function axisWheelZoom(chart) {
  const zr = chart.getZr();
  const grids = () => {
    const out = [];
    const model = chart.getModel();
    for (let i = 0; model && model.getComponent('grid', i); i++) {
      const g = model.getComponent('grid', i);
      if (g.coordinateSystem) out.push({ index: i, model: g, rect: g.coordinateSystem.getRect() });
    }
    return out;
  };
  const axisIndexOf = (dim, gridModel) => {
    const model = chart.getModel();
    for (let k = 0; model.getComponent(dim + 'Axis', k); k++) {
      const ax = model.getComponent(dim + 'Axis', k);
      if (ax.getCoordSysModel && ax.getCoordSysModel() === gridModel) return k;
    }
    return -1;
  };
  zr.on('mousewheel', (e) => {
    if (!chart.getModel()) return;
    const x = e.offsetX, y = e.offsetY;
    const gs = grids();
    if (!gs.length) return;
    const ev = e.event || {};
    let target = null, dims = null;
    for (const g of gs) {
      const r = g.rect;
      const inX = x >= r.x && x <= r.x + r.width, inY = y >= r.y && y <= r.y + r.height;
      if (inX && inY) { target = g; dims = ev.shiftKey ? ['x'] : ev.altKey ? ['y'] : ['x', 'y']; break; }
      if (inY && x < r.x) { target = g; dims = ['y']; break; }                 // over the y-axis labels
      if (inX && y > r.y + r.height && y < r.y + r.height + 48) { target = g; dims = ['x']; break; }   // x-axis labels
    }
    if (!target) return;
    const opt = chart.getOption();
    const dzs = opt.dataZoom || [];
    const factor = (e.wheelDelta > 0) ? 0.8 : 1.25;
    let did = false;
    for (const dim of dims) {
      const k = axisIndexOf(dim, target.model);
      if (k < 0) continue;
      const axis = chart.getModel().getComponent(dim + 'Axis', k).axis;
      const [e0, e1] = axis.scale.getExtent();
      let c = chart.convertFromPixel({ [dim + 'AxisIndex']: k }, dim === 'x' ? x : y);
      if (!isFinite(c)) c = (e0 + e1) / 2;
      c = Math.min(e1, Math.max(e0, c));
      const lo = c - (c - e0) * factor, hi = c + (e1 - c) * factor;
      dzs.forEach((dz, i) => {
        // no axis given → ECharts controls the first x axis
        const none = dz.xAxisIndex == null && dz.yAxisIndex == null;
        const idx = none ? (dim === 'x' ? [0] : []) : [].concat(dz[dim + 'AxisIndex'] ?? []);
        if (idx.includes(k)) {
          chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: i, startValue: lo, endValue: hi });
          did = true;
        }
      });
    }
    if (did && ev.preventDefault) { ev.preventDefault(); e.stop?.(); }
  });
  zr.on('dblclick', () => {
    const dzs = chart.getOption()?.dataZoom || [];
    dzs.forEach((_, i) => chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: i, start: 0, end: 100 }));
  });
}
export function baseAxis(t) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    nameTextStyle: { color: t.ink2, fontSize: 12 },
  };
}
export function baseTooltip(t) {
  return { backgroundColor: t.surface, borderColor: css('--border'), textStyle: { color: t.ink, fontSize: 12 },
           extraCssText: 'box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:6px;' };
}

/** zone index for a value given ascending floors; 0 = below zone 1 */
export function zoneOf(v, floors) {
  let z = 0;
  for (let i = 0; i < floors.length; i++) if (v >= floors[i]) z = i + 1;
  return z;
}

export function zoneBlock(title, secsByZone, names, rangeLabels, firstZone = 0) {
  const total = secsByZone.reduce((a, b) => a + b, 0) || 1;
  const bar = h('div', { class: 'zbar' }, secsByZone.map((s, i) => s > 0
    ? h('div', { style: `flex:${s};background:${zoneColor(i + firstZone)}`, title: `${names[i]}: ${fmtDur(s)}` }) : null));
  const list = h('div', { class: 'zlist' }, secsByZone.flatMap((s, i) => [
    h('span', {}, h('span', { class: 'sw', style: `background:${zoneColor(i + firstZone)}` }), i + firstZone === 0 ? '—' : `Z${i + firstZone}`),
    h('span', { class: 'sub' }, `${names[i]} `, h('span', { class: 'muted' }, rangeLabels[i])),
    h('span', {}, fmtDur(s)),
    h('span', { style: 'text-align:right' }, `${(100 * s / total).toFixed(1)}%`),
  ]));
  return h('div', {}, h('h3', {}, title), bar, list);
}

/** labels for zone ranges */
export function hrZoneLabels(floors) {
  return [`< ${floors[0]}`, ...floors.map((f, i) => (i + 1 < floors.length ? `${f}–${floors[i + 1] - 1}` : `≥ ${f}`))];
}
export function paceZoneLabels(speedFloors) {
  // speed floors ascending → pace ranges (slower bound first)
  const out = [`slower than ${fmtPace(speedFloors[0])}`];
  for (let i = 0; i < speedFloors.length; i++) {
    const lo = speedFloors[i], hi = speedFloors[i + 1];
    out.push(hi ? `${fmtPace(lo)}–${fmtPace(hi)}` : `faster than ${fmtPace(lo)}`);
  }
  if (speedFloors[0] <= 0) out[1] = `slower than ${fmtPace(speedFloors[1])}`;
  return out;
}
export function settingsZones(s) {
  const hrFloors = s.hrZones;
  const speedFloors = s.paceZones.map((f) => f * s.thresholdSpeed);
  return {
    hrFloors, speedFloors,
    hrNames: ['Below Z1', ...s.hrZoneNames],
    paceNames: ['—', ...s.paceZoneNames],
    hrLabels: hrZoneLabels(hrFloors),
    paceLabels: paceZoneLabels(speedFloors),
  };
}

/** one-hue sequential ramp, low → high magnitude, stepped for the current theme */
export function isDarkTheme() {
  const hex = css('--surface').replace('#', '');
  const lum = hex.length === 6 ? (parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16) + parseInt(hex.slice(4, 6), 16)) / 765 : 1;
  return lum < 0.5;
}
/** fixed one-hue blue ramp (low → high), e.g. sleep stages */
export function blueRamp() {
  return isDarkTheme()
    ? ['#104281', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb']
    : ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
}

// ── continuous colour scales (low → high), user-selectable ─────────────────
// 9 stops each. The extreme stop that would vanish into the surface is
// trimmed per theme (darkest on dark, lightest on light).
export const SEQ_PRESETS = {
  viridis: { label: 'Viridis', stops: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'] },
  magma:   { label: 'Magma',   stops: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'] },
  plasma:  { label: 'Plasma',  stops: ['#0d0887', '#47039f', '#7301a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#f0f921'] },
  cividis: { label: 'Cividis', stops: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#fee838'] },
  blues:   { label: 'Blues',   stops: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'] },
};
export const DEFAULT_SEQ_PALETTE = 'viridis';

/** stops for a preset, trimmed for the theme (low → high) */
export function seqStops(name, reverse = false, dark = isDarkTheme()) {
  const p = SEQ_PRESETS[name] || SEQ_PRESETS[DEFAULT_SEQ_PALETTE];
  let st = [...p.stops];
  const lum = (hx) => { const n = parseInt(hx.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255; };
  // drop the end that is closest to the surface
  const darkEnd = lum(st[0]) < lum(st[st.length - 1]) ? 0 : st.length - 1;
  const trimDark = (i) => (i === 0 ? st.slice(1) : st.slice(0, -1));
  st = dark ? trimDark(darkEnd) : trimDark(darkEnd === 0 ? st.length - 1 : 0);
  return reverse ? st.reverse() : st;
}
/** the user's continuous scale (low → high) for the current theme */
export function seqRamp() {
  return seqStops(zoneSettings.seqPalette || DEFAULT_SEQ_PALETTE, !!zoneSettings.seqReverse);
}

// ── zone colour palettes ────────────────────────────────────────────────────
// Six colours each: [below Z1, Z1, Z2, Z3, Z4, Z5]. `dark` (optional) is the
// same palette stepped for the dark surface.
export const ZONE_PRESETS = {
  heat: { label: 'Cool → hot',
    light: ['#d6d5cf', '#8ec5f0', '#f2cf3d', '#f5a03a', '#e8692e', '#c9302c'],
    dark:  ['#3a3a37', '#5a9fd6', '#e0bb2a', '#e8902a', '#e0632a', '#d64541'] },
  garmin: { label: 'Garmin-style',
    light: ['#e4e3de', '#9aa0a6', '#3b8de0', '#3fb24f', '#f29a2e', '#e0433b'],
    dark:  ['#3a3a37', '#7d838a', '#3b8de0', '#3fb24f', '#f29a2e', '#e0433b'] },
  blue: { label: 'Blue (single hue)',
    light: ['#d6d5cf', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
    dark:  ['#383835', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4'] },
  viridis: { label: 'Viridis',
    light: ['#d6d5cf', '#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'],
    dark:  ['#3a3a37', '#fde725', '#5ec962', '#21918c', '#3b528b', '#7a3d9a'] },
};
export const DEFAULT_ZONE_PALETTE = 'heat';

export function zonePaletteColors(s, dark = isDarkTheme()) {
  const name = s.zonePalette || DEFAULT_ZONE_PALETTE;
  if (name === 'custom' && Array.isArray(s.zoneCustom) && s.zoneCustom.length === 6) return s.zoneCustom;
  const p = ZONE_PRESETS[name] || ZONE_PRESETS[DEFAULT_ZONE_PALETTE];
  return dark && p.dark ? p.dark : p.light;
}
let zoneSettings = {};
/** Write the palette into --z0 … --z5 so every zone visual picks it up. */
export function applyZonePalette(s = zoneSettings) {
  zoneSettings = s;
  const root = document.documentElement;
  for (let i = 0; i < 6; i++) root.style.removeProperty(`--z${i}`);   // read the theme's surface first
  zonePaletteColors(s).forEach((c, i) => root.style.setProperty(`--z${i}`, c));
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyZonePalette());

/**
 * OpenStreetMap tile layer. OSM's tile usage policy requires a Referer; the
 * Caddy site sends `Referrer-Policy: no-referrer` for the whole origin, so
 * the tile <img>s override it with `origin` (OSM sees only the host, never
 * a path). Single host: the a/b/c subdomains are deprecated.
 */
export function osmLayer() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    referrerPolicy: 'origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

// ── data quality ─────────────────────────────────────────────────────────────
// `dq_flags` (JSON, set by the importer) → readable issues. Records and curves
// already use glitch-cleaned distance; these say what was wrong with the raw data.
export function dqIssues(flags) {
  if (!flags) return [];
  let f;
  try { f = typeof flags === 'string' ? JSON.parse(flags) : flags; } catch { return []; }
  const out = [];
  if (f.duplicate_of) out.push(`Probably a duplicate upload of activity ${f.duplicate_of}`);
  if (f.distance_mismatch) out.push(`Distance stream claims ${f.distance_mismatch}× the summary distance — excluded from records`);
  if (f.gps_jumps) out.push(`GPS jumps: ${fmtNum(f.removed_m)} m of implausible distance ignored for records and curves`);
  if (f.implausible_speed_s) out.push(`${fmtDur(f.implausible_speed_s)} faster than plausible for this sport — vehicle, or mislabelled activity?`);
  if (f.stride_glitch_s) out.push(`${fmtDur(f.stride_glitch_s)} with impossible stride length (speed vs cadence) masked`);
  if (f.sparse_sampling_s) out.push(`Sparse recording (a point every ~${f.sparse_sampling_s} s) — short efforts unreliable`);
  if (f.hr_cadence_lock_s) out.push(`Heart rate locked onto cadence for ${fmtDur(f.hr_cadence_lock_s)} (optical HR artefact)`);
  if (f.hr_missing_pct) out.push(`Heart rate missing for ${f.hr_missing_pct} % of moving time`);
  return out;
}

export function dqBadge(flags) {
  const issues = dqIssues(flags);
  return issues.length ? h('span', { class: 'dq-badge', title: issues.join('\n'), 'aria-label': 'data quality issues' }, '⚠') : null;
}
