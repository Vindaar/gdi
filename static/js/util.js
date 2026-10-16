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
/** "2026-10-16…" → "2026/10/16" (+ " 10:14" with time). Dates show as YYYY/MM/DD everywhere. */
export function fmtDate(iso, withTime = false) {
  if (!iso) return '–';
  const d = dateSlash(iso.slice(0, 10));
  return withTime ? `${d} ${iso.slice(11, 16)}` : d;
}
/** replace a leading ISO date (YYYY-MM-DD) in a label by YYYY/MM/DD; anything else unchanged */
export const dateSlash = (v) => (typeof v === 'string' ? v.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1/$2/$3') : v);
/** epoch ms → "YYYY/MM/DD" (UTC day, as the ISO strings the charts are built from) */
export const fmtDay = (ms) => fmtDate(new Date(ms).toISOString());

/**
 * Date field shown as YYYY/MM/DD regardless of the browser locale (native
 * date inputs follow it, e.g. mm/dd/yyyy). Behaves like an <input>: `.value`
 * is ISO (YYYY-MM-DD or ''), fires 'change'. A button opens the native picker.
 */
export function dateInput({ value = '', min, max } = {}) {
  const text = h('input', { type: 'text', class: 'date-text', placeholder: 'YYYY/MM/DD', inputmode: 'numeric', size: 10, spellcheck: 'false' });
  const native = h('input', { type: 'date', class: 'date-native', tabindex: '-1', 'aria-hidden': 'true', min, max });
  const btn = h('button', { type: 'button', class: 'date-btn', title: 'Pick a date', 'aria-label': 'Pick a date' }, '📅');
  const box = h('span', { class: 'date-input' }, text, btn, native);
  let iso = '';
  const show = () => { text.value = iso ? dateSlash(iso) : ''; native.value = iso; text.classList.remove('invalid'); };
  const parse = (s) => {
    const m = s.trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (!m) return null;
    const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(out + 'T12:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === out ? out : null;
  };
  const commit = (v) => { if (v === iso) { show(); return; } iso = v; show(); box.dispatchEvent(new Event('change')); };
  text.addEventListener('change', () => {
    if (!text.value.trim()) return commit('');
    const v = parse(text.value);
    if (v) commit(v); else text.classList.add('invalid');
  });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.dispatchEvent(new Event('change')); });
  native.addEventListener('change', () => commit(native.value));
  btn.addEventListener('click', () => { try { native.showPicker(); } catch { native.focus(); native.click(); } });
  Object.defineProperty(box, 'value', { get: () => iso, set: (v) => { iso = v || ''; show(); } });
  box.value = value;
  return box;
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
/**
 * Colour of discrete series `i`. Pass `n` (the number of classes the chart
 * maps to colour) where colour encodes a class: the "ggplot2 hue (per plot)"
 * setting then spaces n hues evenly, like ggplot2 does. Without `n` (single
 * series, fixed meanings) the theme's / fixed palette's colour is used.
 */
export const series = (i, n) => {
  if (n && zoneSettings.catPalette === 'gghue-n') return ggHueCached(n)[i % n];
  return css(`--s${(i % 8) + 1}`);
};
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
    // dates as YYYY/MM/DD: category labels that are ISO dates, and the axis
    // value shown in axis tooltips / pointers of category and time axes
    for (const k of ['xAxis', 'yAxis']) {
      const axes = opt && opt[k] ? (Array.isArray(opt[k]) ? opt[k] : [opt[k]]) : [];
      for (const ax of axes) {
        if (ax.type === 'category') {
          ax.axisLabel = { ...(ax.axisLabel || {}) };
          if (!ax.axisLabel.formatter) ax.axisLabel.formatter = dateSlash;
          ax.axisPointer = { ...(ax.axisPointer || {}), label: { formatter: (p) => dateSlash(String(p.value)), ...(ax.axisPointer?.label || {}) } };
        } else if (ax.type === 'time') {
          ax.axisPointer = { ...(ax.axisPointer || {}), label: { formatter: (p) => fmtDay(p.value), ...(ax.axisPointer?.label || {}) } };
        }
      }
    }
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
// ── page themes (css/app.css) — per browser, chosen in Settings ─────────────
// `swatch`: page, surface, ink, accent, then the first four series colours
export const THEMES = {
  system:   { label: 'System', note: 'follows the light/dark setting of this device' },
  light:    { label: 'Light', swatch: ['#f9f9f7', '#fcfcfb', '#0b0b0b', '#2a78d6', '#2a78d6', '#eb6834', '#1baf7a', '#eda100'] },
  dark:     { label: 'Dark', swatch: ['#0d0d0d', '#1a1a19', '#f0efec', '#3987e5', '#3987e5', '#d95926', '#199e70', '#c98500'] },
  sepia:    { label: 'Sepia', note: 'warm paper', swatch: ['#f4ecd8', '#fbf5e6', '#2b2117', '#a24d17', '#2f6db3', '#c4581f', '#008f74', '#a87a00'] },
  nord:     { label: 'Nord', note: 'cool slate', swatch: ['#242933', '#2e3440', '#eceff4', '#88c0d0', '#5e8fd6', '#cc6436', '#21998a', '#b88a10'] },
  monokai:  { label: 'Monokai', note: 'the editor classic', swatch: ['#1e1f1c', '#272822', '#f8f8f2', '#66d9ef', '#a6e22e', '#f92672', '#fd971f', '#ae81ff'] },
  'monokai-vivid': { label: 'Monokai vivid', note: 'original neon colours in the charts', swatch: ['#1e1f1c', '#272822', '#f8f8f2', '#66d9ef', '#66d9ef', '#fd971f', '#ae81ff', '#a6e22e'] },
  black:    { label: 'Black', note: 'true black for OLED screens', swatch: ['#000000', '#0a0a0a', '#f5f5f5', '#3987e5', '#3987e5', '#d95926', '#199e70', '#c98500'] },
  contrast: { label: 'High contrast', swatch: ['#ffffff', '#ffffff', '#000000', '#0050a8', '#0060a8', '#c24e00', '#008266', '#9a6b00'] },
};
export function currentTheme() {
  try { return localStorage.getItem('gdi:theme') || 'system'; } catch { return 'system'; }
}
export function setTheme(name) {
  try { localStorage.setItem('gdi:theme', name); } catch {}
  if (name === 'system' || !THEMES[name]) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = name;
  applyZonePalette();   // zone presets have light / dark variants
}

// ── discrete series colours ─────────────────────────────────────────────────
/** polar CIE-LUV (R's hcl(), as used by ggplot2's hue_pal) → sRGB hex, D65 */
export function hclHex(h, c, l) {
  const rad = (h * Math.PI) / 180;
  const u = c * Math.cos(rad), v = c * Math.sin(rad);
  const Xn = 95.047, Yn = 100.0, Zn = 108.883;
  const un = (4 * Xn) / (Xn + 15 * Yn + 3 * Zn), vn = (9 * Yn) / (Xn + 15 * Yn + 3 * Zn);
  const Y = l > 8 ? Yn * ((l + 16) / 116) ** 3 : Yn * l / 903.2963;
  const up = u / (13 * l) + un, vp = v / (13 * l) + vn;
  const X = (Y * 9 * up) / (4 * vp), Z = (Y * (12 - 3 * up - 20 * vp)) / (4 * vp);
  const lin = [3.240479 * X - 1.53715 * Y - 0.498535 * Z, -0.969256 * X + 1.875992 * Y + 0.041556 * Z,
               0.055648 * X - 0.204043 * Y + 1.057311 * Z].map((x) => x / 100);
  const gam = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return '#' + lin.map((x) => Math.round(255 * Math.min(1, Math.max(0, gam(x)))).toString(16).padStart(2, '0')).join('');
}
/** ggplot2's default discrete scale: n hues evenly around the wheel from `start` (C 100, L 65) */
export const ggHue = (n, start = 15) => Array.from({ length: n }, (_, i) => hclHex((start + (360 * i) / n) % 360, 100, 65));
const ggCache = new Map();
const ggHueCached = (n) => { if (!ggCache.has(n)) ggCache.set(n, ggHue(n, 285)); return ggCache.get(n); };
export const CAT_PRESETS = {
  theme: { label: 'Theme colours', note: 'tuned per theme, checked for colour-blind separation' },
  gghue: { label: 'ggplot2 hue (8 fixed)', note: '8 hues from 285°, C 100, L 65', colors: () => ggHue(8, 285) },
  'gghue-n': { label: 'ggplot2 hue (per plot)', note: 'n hues from 285° for the n classes of each chart', examples: [2, 3, 5] },
};

let zoneSettings = {};
/** the server-side UI settings (zones, palettes) as last applied */
export const uiSettings = () => zoneSettings;
/** Write the palette into --z0 … --z5 so every zone visual picks it up. */
export function applyZonePalette(s = zoneSettings) {
  zoneSettings = s;
  const root = document.documentElement;
  for (let i = 0; i < 6; i++) root.style.removeProperty(`--z${i}`);   // read the theme's surface first
  zonePaletteColors(s).forEach((c, i) => root.style.setProperty(`--z${i}`, c));
  const cat = CAT_PRESETS[s.catPalette]?.colors?.();
  for (let i = 0; i < 8; i++) {
    if (cat) root.style.setProperty(`--s${i + 1}`, cat[i]);
    else root.style.removeProperty(`--s${i + 1}`);
  }
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

// Garmin's post-activity prompt: perceived effort 1–10 and "how did you feel" 0–100
export const FEEL_LABEL = (v) => (v == null ? null : ['very weak', 'weak', 'normal', 'strong', 'very strong'][Math.round(v / 25)] ?? null);

// ── notes & tags (Org file, see gdi_notes.nim) ──────────────────────────────
export const parseTags = (t) => { try { return t ? (typeof t === 'string' ? JSON.parse(t) : t) : []; } catch { return []; } };
export const TAG_SUGGESTIONS = [
  ['Workout', ['easy', 'long', 'tempo', 'threshold', 'intervals', 'hills', 'strides', 'race', 'recovery', 'loop']],
  ['Body', ['tired', 'sick', 'sore', 'calf', 'achilles', 'knee', 'hip', 'foot', 'great']],
  ['Conditions', ['heat', 'cold', 'wind', 'rain', 'night', 'fasted', 'treadmill', 'altitude', 'new_shoes']],
];
export function tagChips(tags, onClick) {
  return parseTags(tags).map((t) => h(onClick ? 'button' : 'span', { class: 'tag', onclick: onClick ? () => onClick(t) : null }, t));
}

// ── export (GET api/export, see gdi_export.nim) ─────────────────────────────
const EXPORT_LEVELS = [
  ['summary', 'Summary only', 'Garmin stats, laps, splits, zones, weather + our derived numbers. No GPS, no account IDs.'],
  ['data', '+ per-second data', 'Summary plus every sample stream (HR, pace, cadence, power, elevation…) — still without GPS.'],
  ['full', 'Everything incl. GPS', 'The raw Garmin file as synced (JSON), or CSV / GPX with coordinates.'],
];
/** A dropdown that downloads the activities returned by `getIds()`. */
export function exportMenu(getIds, label = '⤓ Export') {
  const st = remember('export', { level: 'data', format: 'json' });
  const box = h('details', { class: 'export-menu' });
  const body = h('div', { class: 'export-pop' });
  function draw() {
    const s = st.get();
    const fmts = [['json', 'JSON'], ['csv', s.level === 'summary' ? 'CSV (one row each)' : 'CSV (samples)'], ...(s.level === 'full' ? [['gpx', 'GPX track']] : [])];
    if (!fmts.some(([f]) => f === s.format)) st.set({ format: 'json' });
    const ids = getIds();
    const multi = ids.length > 1 && !(st.get().format === 'csv' && s.level === 'summary');
    body.replaceChildren(
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, ids.length === 1 ? '1 activity' : `${ids.length} activities${multi ? ' → zip, one file each' : ''}`),
      ...EXPORT_LEVELS.map(([v, l, note]) => h('label', { class: 'export-opt', title: note },
        h('input', { type: 'radio', name: 'exp-level', checked: s.level === v, onchange: () => { st.set({ level: v }); draw(); } }),
        h('span', {}, h('b', {}, l), h('div', { class: 'muted' }, note)))),
      h('div', { style: 'margin:8px 0 4px' }, segmented(fmts, st.get().format, (v) => { st.set({ format: v }); draw(); })),
      h('a', { class: 'button primary', href: ids.length ? `api/export?ids=${ids.join(',')}&level=${s.level}&format=${st.get().format}` : null,
        download: '', onclick: () => { box.open = false; } }, 'Download'));
  }
  box.append(h('summary', { class: 'button' }, label), body);
  box.addEventListener('toggle', () => { if (box.open) draw(); });
  return box;
}

/** Light Org rendering for diary text: headings bold, [[link][desc]] and bare
 *  URLs clickable (Garmin Connect activity links → this app), *bold*,
 *  /italic/, =code= and ~code~. Everything else is shown as written. */
export function orgText(text) {
  const conn = /connect\.garmin\.com\/(?:modern|app)\/activity\/(\d+)/;
  const href = (u) => { const m = u.match(conn); return m ? `#/activity/${m[1]}` : u; };
  const inline = (s) => {
    const out = [];
    const re = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]|(https?:\/\/[^\s<>\]]+)|(^|[\s(])([*/=~])([^\s*/=~](?:[^*/=~\n]*[^\s*/=~])?)\5(?=[\s.,;:!?)]|$)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      const pre = m[4] ?? '';
      out.push(s.slice(last, m.index) + pre);
      if (m[1]) out.push(h('a', { href: href(m[1]), target: href(m[1]).startsWith('#') ? null : '_blank', rel: 'noopener' }, m[2] || m[1]));
      else if (m[3]) out.push(h('a', { href: href(m[3]), target: href(m[3]).startsWith('#') ? null : '_blank', rel: 'noopener' }, m[3]));
      else {
        const tag = { '*': 'b', '/': 'i', '=': 'code', '~': 'code' }[m[5]];
        out.push(h(tag, {}, m[6]));
      }
      last = re.lastIndex;
    }
    out.push(s.slice(last));
    return out;
  };
  return h('div', { class: 'note-text org' }, ...text.split('\n').map((line) => {
    const hm = line.match(/^(\*+)\s+(.*)$/);
    if (hm) return h('div', { class: 'org-h' }, ...inline(hm[2]));
    return h('div', {}, ...(line ? inline(line) : [' ']));
  }));
}
