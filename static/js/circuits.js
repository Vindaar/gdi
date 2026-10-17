// Circuits: loops run several times within runs (gdi_circuits.nim) — list
// (on the Routes page), per-circuit lap history, and the activity-page cards
// "Circuit laps" and "Similar runs".
import {
  api, postJson, objects, h, dataTable, fmtDur, fmtKm, fmtNum, fmtDate, fmtPace, fmtDay,
  TYPE_LABEL, echart, chartTheme, baseAxis, baseTooltip, series, css, osmLayer, seqRamp,
} from './util.js';
import { sketch } from './routes.js';

/** Display name: user-given, else "<location> 1.49 km circuit". */
export function circuitName(c, names = {}) {
  return names[c.id] || names[c.circuit_id] ||
    `${c.location || TYPE_LABEL(c.family)} ${fmtKm(c.length, 2)} km circuit`.trim();
}
const paceOf = (len, secs) => (secs > 0 ? len / secs : null);   // m/s on the circuit's own length

/** Card for the Routes page. */
export async function circuitsCard(family) {
  const [t, settings] = await Promise.all([api('circuits'), api('settings')]);
  const names = settings.circuitNames || {};
  const rows = objects(t).filter((c) => family === 'all' || c.family === family)
    .map((c) => ({ ...c, label: circuitName(c, names), best_pace: paceOf(c.length, c.best_time) }));
  return h('div', { class: 'card', style: 'margin-top:16px' },
    h('h2', {}, 'Circuits'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' },
      'Loops you run several times within one run, found from the GPS tracks. Laps start at the point that gives the most complete laps; a lap must stay on the circuit and be about one circuit long. Times are moving time.'),
    rows.length ? dataTable(rows, [
      { key: 'pts', label: '', fmt: (v) => sketch(v), sortVal: () => 0 },
      { key: 'label', label: 'Circuit', left: true, cls: 'name', link: (r) => `#/circuit/${r.id}` },
      { key: 'family', label: 'Sport', left: true },
      { key: 'length', label: 'km', fmt: (v) => fmtKm(v, 2) },
      { key: 'n_laps', label: 'Laps' },
      { key: 'n_runs', label: 'Runs' },
      { key: 'best_time', label: 'Best lap', fmt: fmtDur, link: (r) => `#/activity/${r.best_id}`, defaultAsc: true },
      { key: 'best_pace', label: 'Best pace', fmt: (v) => fmtPace(v) },
      { key: 'first_date', label: 'First', left: true, fmt: (v) => fmtDate(v) },
      { key: 'last_date', label: 'Last', left: true, fmt: (v) => fmtDate(v) },
    ], { sortKey: 'n_laps', sortDesc: true, id: 'circuits' }) : h('div', { class: 'empty' }, 'No circuits found for this sport.'));
}

/** #/circuit/<id> */
export async function circuitPage(app, id) {
  const [d, settings] = await Promise.all([api(`circuit/${id}`), api('settings', { fresh: true })]);
  const info = d.info;
  const names = settings.circuitNames || {};
  const L0 = info.length;
  const laps = objects(d.laps).map((l) => ({ ...l, pace: paceOf(L0, l.moving), gap: l.avg_gap }));
  const th = chartTheme();
  const charts = [];

  const nameInput = h('input', { type: 'text', value: circuitName(info, names), style: 'font-size:20px;font-weight:650;width:min(520px,100%)' });
  const saved = h('span', { class: 'muted' });
  nameInput.addEventListener('change', async () => {
    const map = { ...(settings.circuitNames || {}), [id]: nameInput.value.trim() };
    if (!nameInput.value.trim()) delete map[id];
    await postJson('settings', { circuitNames: map });
    saved.textContent = 'saved';
  });

  const mk = (hgt = 240) => { const el = h('div', { class: 'chart', style: `height:${hgt}px` }); const c = echart(el); charts.push(c); return [el, c]; };
  const [paceEl, paceChart] = mk(260);
  const [hrEl, hrChart] = mk(200);
  // lap pace over time, coloured by lap number within the run (fatigue / warm-up)
  const maxLap = Math.max(1, ...laps.map((l) => l.lap));
  const ramp = seqRamp();
  const lapColor = (n) => ramp[Math.round((Math.min(n, maxLap) - 1) * (ramp.length - 1) / Math.max(1, maxLap - 1))];
  const pt = (l, y) => ({ value: [Date.parse(l.start_local) + (l.t_start || 0) * 1000, y, l.name, l.activity_id, l.lap],
                          itemStyle: { color: lapColor(l.lap), opacity: 0.8 } });
  const sorted = [...laps].sort((a, b) => Date.parse(a.start_local) - Date.parse(b.start_local) || a.lap - b.lap);
  const roll = (f) => sorted.map((l, i) => {
    const w = sorted.slice(Math.max(0, i - 19), i + 1).map(f).filter((v) => v != null).sort((a, b) => a - b);
    return [Date.parse(l.start_local) + (l.t_start || 0) * 1000, w.length ? w[w.length >> 1] : null];
  });
  const base = (fmt, inverse) => ({
    animation: false, grid: { left: 56, right: 12, top: 26, bottom: 30 },
    tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => (p.seriesType !== 'scatter' ? `median of 20 laps: ${fmt(p.data[1])}`
      : `<b>${p.data.value[2]}</b><br>${fmtDay(p.data.value[0])} · lap ${p.data.value[4]}<br>${fmt(p.data.value[1])}`) },
    xAxis: { type: 'time', ...baseAxis(th), splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, inverse, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: fmt } },
    dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
  });
  const paceSecs = (v) => (v ? 1000 / v : null);
  paceChart.setOption({ ...base((v) => fmtDur(v), true),
    legend: { top: 0, textStyle: { color: th.ink2 }, data: ['Laps (colour: lap number in the run, along your continuous scale: lap 1 at its low end)', 'Median of 20 laps'] },
    series: [
      { name: 'Laps (colour: lap number in the run, along your continuous scale: lap 1 at its low end)', type: 'scatter', symbolSize: 7, data: sorted.filter((l) => l.pace).map((l) => pt(l, paceSecs(l.pace))) },
      { name: 'Median of 20 laps', type: 'line', symbol: 'none', data: roll((l) => paceSecs(l.pace)), lineStyle: { width: 2.5, color: th.ink }, itemStyle: { color: th.ink } },
    ] });
  hrChart.setOption({ ...base((v) => `${Math.round(v)}`, false),
    series: [
      { type: 'scatter', symbolSize: 7, data: sorted.filter((l) => l.avg_hr).map((l) => pt(l, l.avg_hr)) },
      { type: 'line', symbol: 'none', data: roll((l) => l.avg_hr), lineStyle: { width: 2.5, color: th.ink }, itemStyle: { color: th.ink } },
    ] });
  for (const c of [paceChart, hrChart]) c.on('click', (p) => { if (p.seriesType === 'scatter') location.hash = `#/activity/${p.data.value[3]}`; });

  const ranked = [...laps].sort((a, b) => a.moving - b.moving).map((l, i) => ({ ...l, rank: i + 1 }));
  const table = dataTable(ranked, [
    { key: 'rank', label: '#', defaultAsc: true },
    { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v, true), link: (r) => `#/activity/${r.activity_id}` },
    { key: 'lap', label: 'Lap', defaultAsc: true },
    { key: 'moving', label: 'Time', fmt: fmtDur, defaultAsc: true },
    { key: 'pace', label: 'Pace', fmt: (v) => fmtPace(v) },
    { key: 'gap', label: 'GAP', fmt: (v) => (v ? fmtPace(v) : '–') },
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    { key: 'w_temp', label: '°C', fmt: (v) => fmtNum(v) },
    { key: 'run_distance', label: 'Run km', fmt: (v) => fmtKm(v, 1) },
    { key: 'name', label: 'Run', left: true, cls: 'name' },
  ], { sortKey: 'start_local', sortDesc: true, id: 'circuit-laps', pageSize: 50 });

  const mapEl = h('div', { id: 'map', style: 'height:360px' });
  const runsN = new Set(laps.map((l) => l.activity_id)).size;
  const best = ranked[0];
  app.replaceChildren(
    h('div', { class: 'page-head' }, nameInput, saved, h('span', { class: 'chip' }, info.family),
      h('span', { class: 'sub' }, `${fmtKm(L0, 2)} km · ${laps.length} laps in ${runsN} runs · ${fmtDate(info.first_date)} → ${fmtDate(info.last_date)}`),
      best ? h('a', { href: `#/activity/${best.activity_id}` }, `best lap ${fmtDur(best.moving)} (${fmtDate(best.start_local)}, lap ${best.lap})`) : null),
    h('div', { class: 'grid', style: 'grid-template-columns:minmax(0,2fr) minmax(0,3fr);margin-bottom:16px;align-items:start' },
      h('div', { class: 'card' }, mapEl,
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, 'Green dot: lap start. Arrows: running direction.')),
      h('div', { class: 'card' },
        h('h3', {}, `Lap pace on the circuit's ${fmtKm(L0, 2)} km (faster = up)`), paceEl,
        h('h3', {}, 'Average heart rate per lap'), hrEl)),
    h('div', { class: 'card' }, h('h2', {}, 'All laps'), table));

  const pts = JSON.parse(info.pts || '[]');
  if (pts.length) {
    const map = L.map(mapEl);
    osmLayer().addTo(map);
    const line = L.polyline(pts, { color: css('--s1'), weight: 4 }).addTo(map);
    // direction arrows at 1/8, 3/8, 5/8, 7/8 of the circuit
    for (const f of [0.125, 0.375, 0.625, 0.875]) {
      const i = Math.min(pts.length - 2, Math.floor(f * pts.length));
      const [a, b] = [pts[i], pts[i + 1]];
      const deg = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;   // 0 = north
      L.marker(a, { interactive: false, icon: L.divIcon({ className: 'circuit-arrow',
        html: `<span style="transform:rotate(${deg}deg);color:${css('--s1')}">▲</span>`, iconSize: [16, 16] }) }).addTo(map);
    }
    map.fitBounds(line.getBounds(), { padding: [16, 16] });
    L.circleMarker(pts[0], { radius: 6, color: css('--good'), fillOpacity: 1 }).addTo(map).bindTooltip('Lap start');
    charts.push({ dispose: () => map.remove() });
  }
  return () => charts.forEach((c) => c.dispose());
}

/** Activity page: this run's laps on circuits. */
export function activityCircuitsCard(circuits, settings, family) {
  if (!circuits || !circuits.length) return null;
  const names = settings.circuitNames || {};
  return h('div', { class: 'card' }, h('h2', {}, 'Circuit laps'),
    circuits.map((c) => {
      const laps = objects(c.laps).map((l) => ({ ...l, pace: paceOf(c.length, l.moving),
        vs: c.median != null ? l.moving - c.median : null }));
      return h('div', { style: 'margin-bottom:10px' },
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' },
          h('a', { href: `#/circuit/${c.circuit_id}` }, circuitName({ ...c, id: c.circuit_id, family }, names)),
          ` · ${c.n_laps} laps in total · median ${fmtDur(c.median)} · best ${fmtDur(c.best)}`),
        dataTable(laps, [
          { key: 'lap', label: 'Lap', defaultAsc: true },
          { key: 'moving', label: 'Time', fmt: fmtDur },
          { key: 'pace', label: 'Pace', fmt: (v) => fmtPace(v) },
          { key: 'avg_gap', label: 'GAP', fmt: (v) => (v ? fmtPace(v) : '–') },
          { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
          { key: 'vs', label: 'vs median', fmt: (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtDur(Math.abs(v))}`) },
          { key: 'rank', label: 'Rank', fmt: (v) => `#${v} of ${c.n_laps}` },
        ], { sortKey: 'lap', sortDesc: false }));
    }));
}

/** Activity page: runs sharing track with this one. */
export function similarRunsCard(similar, me) {
  const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round(100 * part / whole)) : 0);
  const rows = objects(similar || { cols: [], rows: [] });
  if (!rows.length) return null;
  return h('div', { class: 'card' }, h('h2', {}, 'Similar runs'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' },
      'Runs sharing track with this one (within 20 m, same direction). Shared: % of this run · % of the other. Same route first, then runs that share parts.'),
    dataTable(rows, [
      { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v), link: (r) => `#/activity/${r.id}` },
      { key: 'distance', label: 'km', fmt: (v) => fmtKm(v, 1) },
      { key: 'moving_duration', label: 'Time', fmt: fmtDur },
      { key: 'avg_gap_speed', label: 'GAP', fmt: (v) => (v ? fmtPace(v) : '–') },
      { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
      { key: 'score', label: 'Shared', fmt: (v, r) => `${pct(r.shared_me, me.distance)} % · ${pct(r.shared_other, r.distance)} %`,
        title: (r) => `${fmtKm(r.shared_me, 1)} km of this run lie on the other; ${fmtKm(r.shared_other, 1)} km of the other lie on this one`,
        sortVal: (r) => r.score },
      { key: 'id', label: '', sortVal: () => 0, fmt: (v) => h('a', { href: `#/compare?ids=${me.id},${v}` }, 'compare') },
    ], { sortKey: 'score', sortDesc: true, pageSize: 15 }));
}
