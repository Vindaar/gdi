// Repeated routes: list (with track sketches) and per-route history.
import {
  api, postJson, objects, h, dataTable, fmtDur, fmtKm, fmtNum, fmtDate, fmtPace, fmtSpeedFor, speedUnit,
  usesPace, TYPE_LABEL, FAMILIES, remember, echart, chartTheme, baseAxis, baseTooltip, series, css,
  osmLayer,
} from './util.js';

const state = remember('routes', { family: 'running', minRuns: 3 });

/** Display name: user-given, else "<location> 5.7 km loop". */
export function routeName(r, names = {}) {
  if (names[r.route_id]) return names[r.route_id];
  const pts = typeof r.pts === 'string' ? JSON.parse(r.pts || '[]') : r.pts || [];
  let shape = '';
  if (pts.length) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const d = Math.hypot((a[0] - b[0]) * 111e3, (a[1] - b[1]) * 111e3 * Math.cos(a[0] * Math.PI / 180));
    // out and back: start ≈ end and the second half retraces the first
    const dd = (p, q) => Math.hypot((p[0] - q[0]) * 111e3, (p[1] - q[1]) * 111e3 * Math.cos(p[0] * Math.PI / 180));
    let back = 0;
    for (let k = 0; k < pts.length; k++) back += dd(pts[k], pts[pts.length - 1 - k]);
    back /= pts.length;
    shape = d >= 250 ? 'point to point' : back < 80 ? 'out and back' : 'loop';
  }
  return `${r.location || TYPE_LABEL(r.family)} ${fmtKm(r.ref_distance, 1)} km ${shape}`.trim();
}

/** Tiny SVG sketch of a route signature. */
export function sketch(ptsJson, w = 64, hgt = 40) {
  const pts = typeof ptsJson === 'string' ? JSON.parse(ptsJson || '[]') : ptsJson || [];
  if (pts.length < 2) return h('span', {});
  const k = Math.cos(pts[0][0] * Math.PI / 180);
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sc = Math.min((w - 6) / (x1 - x0 || 1e-9), (hgt - 6) / (y1 - y0 || 1e-9));
  const ox = (w - (x1 - x0) * sc) / 2, oy = (hgt - (y1 - y0) * sc) / 2;
  const path = pts.map((_, i) => `${(ox + (xs[i] - x0) * sc).toFixed(1)},${(oy + (ys[i] - y0) * sc).toFixed(1)}`).join(' ');
  const [sx, sy] = path.split(' ')[0].split(',');
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('width', w); el.setAttribute('height', hgt); el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  el.innerHTML = `<polyline points="${path}" fill="none" stroke="${css('--s1')}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="${sx}" cy="${sy}" r="2.5" fill="${css('--good')}"/>`;
  return el;
}

export async function routesPage(app) {
  const [t, settings] = await Promise.all([api('routes'), api('settings')]);
  const names = settings.routeNames || {};
  const all = objects(t);
  const s = state.get();
  const famSel = h('select', {}, h('option', { value: 'all' }, 'All sports'),
    FAMILIES.map((f) => h('option', { value: f, selected: s.family === f }, f)));
  const minRuns = h('input', { type: 'number', min: 2, value: s.minRuns, style: 'width:70px' });
  const box = h('div', {});
  function render() {
    state.set({ family: famSel.value, minRuns: +minRuns.value || 2 });
    const rows = all.filter((r) => (famSel.value === 'all' || r.family === famSel.value) && r.n >= (+minRuns.value || 2))
      .map((r) => ({ ...r, label: routeName(r, names) }));
    box.replaceChildren(dataTable(rows, [
      { key: 'pts', label: '', fmt: (v) => sketch(v), sortVal: () => 0 },
      { key: 'label', label: 'Route', left: true, cls: 'name', link: (r) => `#/route/${r.route_id}` },
      { key: 'family', label: 'Sport', left: true },
      { key: 'ref_distance', label: 'km', fmt: (v) => fmtKm(v, 1) },
      { key: 'ref_gain', label: 'Ascent', fmt: (v) => fmtNum(v) },
      { key: 'n', label: 'Times' },
      { key: 'best_time', label: 'Best', fmt: fmtDur, link: (r) => `#/activity/${r.best_id}`, defaultAsc: true },
      { key: 'first', label: 'First', left: true, fmt: (v) => fmtDate(v) },
      { key: 'last', label: 'Last', left: true, fmt: (v) => fmtDate(v) },
    ], { sortKey: 'n', sortDesc: true, id: 'routes' }));
  }
  famSel.addEventListener('change', render);
  minRuns.addEventListener('input', render);
  render();
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Routes'),
      h('span', { class: 'sub' }, 'Routes you have done repeatedly (same start, end and track within GPS tolerance; reverse direction counts separately).')),
    h('div', { class: 'filters' }, h('label', {}, 'Sport', famSel), h('label', {}, 'At least … times', minRuns)),
    h('div', { class: 'card' }, box));
}

export async function routePage(app, id) {
  const [d, settings] = await Promise.all([api(`route/${id}`), api('settings', { fresh: true })]);
  const info = d.info;
  const fam = info.family;
  const names = settings.routeNames || {};
  const runs = objects(d.runs).map((r) => ({ ...r, speed: r.distance && r.moving_duration ? r.distance / r.moving_duration : null }));
  const selected = new Set();
  const th = chartTheme();
  const charts = [];

  // name (editable)
  const nameInput = h('input', { type: 'text', value: routeName(info, names), style: 'font-size:20px;font-weight:650;width:min(520px,100%)' });
  const saved = h('span', { class: 'muted' });
  nameInput.addEventListener('change', async () => {
    const map = { ...(settings.routeNames || {}), [id]: nameInput.value.trim() };
    if (!nameInput.value.trim()) delete map[id];
    await postJson('settings', { routeNames: map });
    saved.textContent = 'saved';
  });

  // map with the reference activity's full track
  const mapEl = h('div', { id: 'map', style: 'height:360px' });
  // charts: route time, average HR, vs expected (running) — one measure each
  const mkChart = () => { const el = h('div', { class: 'chart', style: 'height:220px' }); const c = echart(el); charts.push(c); return [el, c]; };
  const [timeEl, timeChart] = mkChart();
  const [hrEl, hrChart] = mkChart();
  const [expEl, expChart] = mkChart();
  const pts = (f) => runs.filter((r) => f(r) != null).map((r) => [Date.parse(r.start_local), f(r), r.name, r.id]);
  const setScatter = (c, data, yFmt, inverse = false, extra = {}) => c.setOption({
    animation: false, grid: { left: 56, right: 12, top: 12, bottom: 30 },
    tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `<b>${p.data[2]}</b><br>${fmtDate(new Date(p.data[0]).toISOString())} · ${yFmt(p.data[1])}` },
    xAxis: { type: 'time', ...baseAxis(th), splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, inverse, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: yFmt } },
    dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
    series: [{ type: 'scatter', symbolSize: 8, data, itemStyle: { color: series(0), opacity: 0.75 }, ...extra }],
  });
  setScatter(timeChart, pts((r) => r.moving_duration), fmtDur, true);
  setScatter(hrChart, pts((r) => r.avg_hr), (v) => `${Math.round(v)}`);
  const hasExp = runs.some((r) => r.exp_delta != null);
  if (hasExp) setScatter(expChart, pts((r) => r.exp_delta), (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`, true);
  for (const c of charts) c.on('click', (p) => { if (p.data) location.hash = `#/activity/${p.data[3]}`; });

  // runs table with compare selection
  const compareBtn = h('button', { class: 'primary', disabled: true, onclick: () => { location.hash = `#/compare?ids=${[...selected].join(',')}`; } }, 'Compare selected');
  const updateBtn = () => {
    compareBtn.disabled = selected.size < 2 || selected.size > 4;
    compareBtn.textContent = selected.size ? `Compare ${selected.size} selected` : 'Compare selected (2–4)';
  };
  updateBtn();
  const ranked = [...runs].sort((a, b) => a.moving_duration - b.moving_duration).map((r, i) => ({ ...r, rank: i + 1 }));
  const table = dataTable(ranked, [
    { key: 'sel', label: '', sortVal: () => 0, fmt: (v, r) => {
      const cb = h('input', { type: 'checkbox', checked: selected.has(r.id) });
      cb.addEventListener('change', () => { cb.checked ? selected.add(r.id) : selected.delete(r.id); updateBtn(); });
      return cb;
    } },
    { key: 'rank', label: '#', defaultAsc: true },
    { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v, true), link: (r) => `#/activity/${r.id}` },
    { key: 'moving_duration', label: 'Time', fmt: fmtDur, defaultAsc: true },
    { key: 'speed', label: usesPace(fam) ? 'Pace' : 'Speed', fmt: (v) => `${fmtSpeedFor(fam, v)} ${speedUnit(fam)}` },
    usesPace(fam) ? { key: 'avg_gap_speed', label: 'GAP', fmt: (v) => (v ? fmtPace(v) : '–') } : null,
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    hasExp ? { key: 'exp_delta', label: 'vs exp.', fmt: (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`) } : null,
    { key: 'w_temp', label: '°C', fmt: (v) => fmtNum(v) },
    { key: 'name', label: 'Name', left: true, cls: 'name' },
    { key: 'match_m', label: 'Track match', fmt: (v) => (v ? `${Math.round(v)} m` : 'reference'), title: () => 'mean distance from the route\'s reference track' },
  ].filter(Boolean), { sortKey: 'start_local', sortDesc: true, id: 'route-runs' });

  const best = ranked[0];
  app.replaceChildren(
    h('div', { class: 'page-head' }, nameInput, saved,
      h('span', { class: 'chip' }, fam), h('span', { class: 'sub' }, `${fmtKm(info.ref_distance, 1)} km · ${runs.length} times · ${fmtDate(runs[0]?.start_local)} → ${fmtDate(runs[runs.length - 1]?.start_local)}`),
      best ? h('a', { href: `#/activity/${best.id}` }, `best ${fmtDur(best.moving_duration)} (${fmtDate(best.start_local)})`) : null),
    h('div', { class: 'grid', style: 'grid-template-columns:minmax(0,2fr) minmax(0,3fr);margin-bottom:16px;align-items:start' },
      h('div', { class: 'card' }, mapEl),
      h('div', { class: 'card' },
        h('h3', {}, 'Moving time per run (faster = up)'), timeEl,
        h('h3', {}, 'Average heart rate'), hrEl,
        hasExp ? h('h3', {}, 'Vs expected pace (s/km, − = faster; accounts for HR, drift and terrain)') : null, hasExp ? expEl : null)),
    h('div', { class: 'card' },
      h('div', { class: 'filters', style: 'margin-bottom:8px' }, h('h2', { style: 'margin:0' }, 'All runs on this route'), compareBtn),
      table));

  // map: full track of the reference activity
  try {
    const st = await api(`activity/${id}/streams`);
    const lat = st.directLatitude || [], lon = st.directLongitude || [];
    const track = lat.map((la, i) => [la, lon[i]]).filter((p) => p[0] != null && p[1] != null && p[0] !== 0);
    if (track.length) {
      const map = L.map(mapEl);
      osmLayer().addTo(map);
      const line = L.polyline(track, { color: css('--s1'), weight: 3 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [12, 12] });
      L.circleMarker(track[0], { radius: 5, color: css('--good'), fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      charts.push({ dispose: () => map.remove() });
    }
  } catch {}
  return () => charts.forEach((c) => c.dispose());
}
