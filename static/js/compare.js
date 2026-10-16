// Compare 2–4 activities: overlays by distance (time gap, pace, HR,
// elevation) and their key statistics side by side.
import {
  api, h, fmtDur, fmtKm, fmtNum, fmtDate, fmtPace, fmtSpeedFor, speedUnit, usesPace, TYPE_LABEL, css, series,
} from './util.js';

const STEP = 25;   // m, common distance grid

/** robust pace range (ignore the slowest few % — starts, stops) */
function paceRange(ys) {
  const v = ys.flat().filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return [180, 600];
  return [Math.max(120, v[Math.floor(v.length * 0.01)] - 15), Math.min(1200, v[Math.floor(v.length * 0.97)] + 30)];
}

/** Resample a stream onto the distance grid (linear in distance). */
function onGrid(dist, ys, grid) {
  const out = new Array(grid.length).fill(null);
  let j = 0;
  for (let g = 0; g < grid.length; g++) {
    const x = grid[g];
    while (j < dist.length - 1 && !(dist[j + 1] >= x)) j++;
    if (j >= dist.length - 1) break;
    const d0 = dist[j], d1 = dist[j + 1];
    if (d0 == null || d1 == null || ys[j] == null || ys[j + 1] == null) continue;
    const f = d1 > d0 ? (x - d0) / (d1 - d0) : 0;
    out[g] = ys[j] + f * (ys[j + 1] - ys[j]);
  }
  return out;
}
function smoothGrid(ys, w) {
  return ys.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(ys.length - 1, i + w); k++) if (ys[k] != null) { s += ys[k]; n++; }
    return n ? s / n : null;
  });
}

export async function comparePage(app) {
  const ids = (new URLSearchParams(location.hash.split('?')[1] || '').get('ids') || '').split(',').filter(Boolean).slice(0, 4);
  if (ids.length < 2) { app.replaceChildren(h('div', { class: 'empty' }, 'Select 2–4 activities to compare (from a route page or the activity list).')); return; }
  const data = await Promise.all(ids.map((id) => Promise.all([api(`activity/${id}`), api(`activity/${id}/streams`)])));
  const acts = data.map(([d]) => d.activity);
  const fam = acts[0].parent_type;
  const plots = [];

  // monotone distance per activity
  const tracks = data.map(([, st]) => {
    let last = 0;
    const dist = (st.sumDistance || []).map((v) => (v == null ? last : (last = Math.max(last, v))));
    return { st, dist };
  });
  const maxD = Math.min(...tracks.map((t) => t.dist[t.dist.length - 1] || 0));
  const grid = [];
  for (let x = 0; x <= maxD; x += STEP) grid.push(x);
  const xs = grid.map((x) => x / 1000);
  // moving time, so stops (traffic lights …) don't show up as lost time
  const time = tracks.map((t) => onGrid(t.dist, t.st.sumMovingDuration || t.st.t || [], grid));
  const ref = time[0];

  const seriesFor = (label, f, opts = {}) => ({ label, f, ...opts });
  const panels = [
    seriesFor('Time gap vs the first activity (moving time, s, + = behind)', (i) => time[i].map((t, g) => (t == null || ref[g] == null ? null : t - ref[g])), { fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} s` }),
    seriesFor(usesPace(fam) ? 'Pace (/km, 200 m smoothing)' : 'Speed (km/h)', (i) => {
      const sp = smoothGrid(onGrid(tracks[i].dist, tracks[i].st.directSpeed || [], grid), 4);
      return sp.map((v) => (v == null || v < 0.5 ? null : usesPace(fam) ? 1000 / v : v * 3.6));
    }, { pace: usesPace(fam), fmt: (v) => (usesPace(fam) ? fmtDur(v) : v.toFixed(1)) }),
    seriesFor('Heart rate (bpm)', (i) => smoothGrid(onGrid(tracks[i].dist, tracks[i].st.directHeartRate || [], grid), 2), { fmt: (v) => Math.round(v) }),
    seriesFor('Elevation (m)', (i) => onGrid(tracks[i].dist, tracks[i].st.directElevation || [], grid), { fmt: (v) => Math.round(v) }),
  ];
  const chartsEl = h('div', { class: 'stream-charts' });
  const legend = h('div', { class: 'filters', style: 'margin-bottom:8px' }, acts.map((a, i) =>
    h('span', { style: 'display:flex;gap:6px;align-items:center' }, h('span', { style: `width:14px;height:3px;background:${series(i, acts.length)};display:inline-block` }),
      h('a', { href: `#/activity/${a.id}` }, `${fmtDate(a.start_local)} · ${a.name}`))));

  // stats table: one column per activity
  const rows = [
    ['Date', (a) => fmtDate(a.start_local, true)],
    ['Type', (a) => TYPE_LABEL(a.type_key)],
    ['Distance', (a) => `${fmtKm(a.distance)} km`],
    ['Moving time', (a) => fmtDur(a.moving_duration)],
    ['Elapsed time', (a) => fmtDur(a.elapsed_duration)],
    [usesPace(fam) ? 'Pace' : 'Speed', (a) => `${fmtSpeedFor(fam, a.avg_moving_speed)} ${speedUnit(fam)}`],
    ['GAP', (a) => (a.avg_gap_speed ? `${fmtPace(a.avg_gap_speed)} /km` : '–')],
    ['HR avg / max', (a) => `${fmtNum(a.avg_hr)} / ${fmtNum(a.max_hr)}`],
    ['Ascent / descent', (a) => `${fmtNum(a.elev_gain)} / ${fmtNum(a.elev_loss)} m`],
    ['Cadence', (a) => fmtNum(a.avg_cadence)],
    ['Power avg', (a) => (a.avg_power ? `${fmtNum(a.avg_power)} W` : '–')],
    ['Training effect', (a) => `${fmtNum(a.aerobic_te, 1)} / ${fmtNum(a.anaerobic_te, 1)}`],
    ['Load', (a) => fmtNum(a.training_load)],
    ['Aerobic decoupling', (a) => (a.decoupling != null ? `${a.decoupling > 0 ? '+' : ''}${fmtNum(a.decoupling, 1)} %${a.decoupling_steady ? '' : ' (not steady)'}` : '–')],
    ['Weather', (a) => (a.w_temp != null ? `${fmtNum(a.w_temp)} °C ${a.w_type || ''}` : '–')],
  ];
  const exp = data.map(([d]) => d.model);
  if (exp.some(Boolean)) rows.push(['Vs expected pace', (a, i) => (exp[i] ? `${exp[i].delta > 0 ? '+' : '−'}${Math.abs(Math.round(exp[i].delta))} s/km` : '–')]);
  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', { class: 'l' }, ''), acts.map((a, i) => h('th', {}, h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${series(i, acts.length)};margin-right:6px` }), `#${i + 1}`)))),
    h('tbody', {}, rows.map(([label, f]) => h('tr', {}, h('td', { class: 'l sub' }, label), acts.map((a, i) => h('td', {}, f(a, i)))))));

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, `Compare ${acts.length} activities`)),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'table-wrap' }, table)),
    h('div', { class: 'card' }, legend,
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, `By distance, over the first ${fmtKm(maxD, 1)} km (the shortest activity). Drag to zoom, double-click resets.`),
      chartsEl));

  const syncKey = 'cmp-' + ids.join('-');
  for (const p of panels) {
    const el = h('div', { style: 'margin-bottom:8px' });
    chartsEl.append(el);
    const ys = acts.map((_, i) => p.f(i));
    const opts = {
      title: p.label, width: Math.max(300, chartsEl.clientWidth - 8), height: 190,
      cursor: { sync: { key: syncKey }, drag: { x: true, y: false } },
      scales: { x: { time: false }, y: p.pace ? { dir: -1, range: () => paceRange(ys) } : { auto: true } },
      axes: [
        { stroke: css('--muted'), grid: { stroke: css('--grid') }, ticks: { show: false }, values: (u, v) => v.map((x) => `${x.toFixed(1)} km`) },
        { stroke: css('--muted'), grid: { stroke: css('--grid') }, ticks: { show: false }, size: 56, values: (u, v) => v.map((x) => (p.pace ? fmtDur(x) : x)) },
      ],
      series: [{ label: 'km', value: (u, v) => (v == null ? '–' : v.toFixed(2)) },
        ...acts.map((a, i) => ({ label: `#${i + 1}`, stroke: series(i, acts.length), width: 1.5, points: { show: false }, value: (u, v) => (v == null ? '–' : p.fmt(v)) }))],
    };
    plots.push(new uPlot(opts, [xs, ...ys], el));
  }
  const onResize = () => plots.forEach((p) => p.setSize({ width: Math.max(300, chartsEl.clientWidth - 8), height: 190 }));
  window.addEventListener('resize', onResize);
  return () => { window.removeEventListener('resize', onResize); plots.forEach((p) => p.destroy()); };
}
