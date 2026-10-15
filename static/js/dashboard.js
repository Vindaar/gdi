// Performance dashboard: volume, time-in-zone over time (HR / pace / GAP),
// aerobic efficiency trend and training load — at day/week/month/year
// resolution over any range.
import {
  api, objects, h, fmtDur, fmtNum, fmtKm, fmtPace, FAMILIES, remember, echart, chartTheme,
  baseAxis, baseTooltip, series, zoneColor, segmented, settingsZones, zoneBlock, usesPace, tile,
  dataTable, fmtDate, fmtSpeedFor, speedUnit, TYPE_LABEL,
} from './util.js';
import { createGarminCard } from './garminview.js';

const state = remember('dashboard', { family: 'running', group: 'week', range: '365', metric: 'distance', zoneKind: 'hr', zonePct: true });

function periodKey(iso, group) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  if (group === 'day') return iso.slice(0, 10);
  if (group === 'month') return iso.slice(0, 7);
  if (group === 'year') return iso.slice(0, 4);
  // ISO-ish week starting Monday → label by the Monday's date
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
// SQLite's %W week → Monday date (matches periodKey for weeks)
function sqliteWeekToMonday(p) {
  const [y, w] = p.split('-W').map(Number);
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const firstMon = new Date(jan1);
  firstMon.setUTCDate(1 + ((8 - jan1.getUTCDay()) % 7));
  const d = new Date(firstMon);
  d.setUTCDate(firstMon.getUTCDate() + (w - 1) * 7);
  return d.toISOString().slice(0, 10);
}
/** [first day, last day] (ISO dates) covered by a period label */
function periodRange(p, group) {
  if (group === 'day') return [p, p];
  if (group === 'year') return [`${p}-01-01`, `${p}-12-31`];
  if (group === 'month') {
    const [y, m] = p.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${p}-01`, `${p}-${String(last).padStart(2, '0')}`];
  }
  const d = new Date(p + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return [p, d.toISOString().slice(0, 10)];
}
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const median = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

function allPeriods(fromIso, toIso, group) {
  const out = [];
  const d = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  if (group === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (group === 'month') d.setUTCDate(1);
  if (group === 'year') { d.setUTCMonth(0); d.setUTCDate(1); }
  while (d <= end) {
    out.push(periodKey(d.toISOString(), group));
    if (group === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (group === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else if (group === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return out;
}

export async function dashboardPage(app) {
  const acts = objects(await api('activities'));
  const settings = await api('settings');
  const Z = settingsZones(settings);
  const charts = [];
  const mk = (cls = 'chart') => { const el = h('div', { class: cls }); const c = echart(el); charts.push(c); return [el, c]; };
  const [volEl, volChart] = mk();
  const [zoneEl, zoneChart] = mk('chart tall');
  const [effEl, effChart] = mk();
  const [loadEl, loadChart] = mk();
  const [fitEl, fitChart] = mk();
  const [devEl, devChart] = mk();
  const [decEl, decChart] = mk();
  const garmin = createGarminCard(mk);
  const timeCharts = [loadChart, fitChart, devChart, decChart, ...garmin.charts];   // x = dates (ms)
  const tilesEl = h('div', { class: 'tiles', style: 'margin-bottom:16px' });
  const zoneTotalEl = h('div', {});
  const controls = h('div', { class: 'filters' });
  const zoomBar = h('div', { class: 'filters', style: 'margin:-4px 0 12px' });
  const selectionEl = h('div', { class: 'card', style: 'margin-top:16px', hidden: true });
  const catCharts = [volChart, zoneChart, effChart];   // x = period categories
  // filled by draw(): what the charts currently show
  let ctx = null;
  let zoom = null;       // {from, to} ISO dates, null = full range
  let syncing = false;

  function drawControls() {
    const s = state.get();
    controls.replaceChildren(
      h('label', {}, 'Sport', segmented([['all', 'All'], ...FAMILIES.slice(0, 3).map((f) => [f, f])], s.family, (v) => { state.set({ family: v }); draw(); })),
      h('label', {}, 'Resolution', segmented([['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']], s.group, (v) => { state.set({ group: v }); draw(); })),
      h('label', {}, 'Range', segmented([['90', '3 mo'], ['182', '6 mo'], ['365', '1 y'], ['730', '2 y'], ['1826', '5 y'], ['all', 'All']], s.range, (v) => { state.set({ range: v }); draw(); })),
    );
  }

  async function draw() {
    const s = state.get();
    const th = chartTheme();
    const today = new Date().toISOString().slice(0, 10);
    const fromIso = s.range === 'all'
      ? (acts.length ? acts[acts.length - 1].start_local.slice(0, 10) : today)
      : new Date(Date.now() - +s.range * 86400e3).toISOString().slice(0, 10);
    const rows = acts.filter((a) => (s.family === 'all' || a.parent_type === s.family) && a.start_local.slice(0, 10) >= fromIso);
    const periods = allPeriods(fromIso, today, s.group);
    const idx = new Map(periods.map((p, i) => [p, i]));

    zoom = null;

    // volume
    const M = { distance: ['Distance (km)', (r) => (r.distance || 0) / 1000], time: ['Moving time (h)', (r) => (r.moving_duration || 0) / 3600],
                ascent: ['Ascent (m)', (r) => r.elev_gain || 0], load: ['Training load', (r) => r.training_load || 0], count: ['Activities', () => 1] };
    const [mLabel, mGet] = M[s.metric];
    const vol = new Array(periods.length).fill(0);
    for (const r of rows) { const i = idx.get(periodKey(r.start_local, s.group)); if (i != null) vol[i] += mGet(r); }
    volChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 16, bottom: 64 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 6, borderColor: 'transparent',
        backgroundColor: th.grid, fillerColor: 'rgba(42,120,214,0.15)', dataBackground: { lineStyle: { color: th.axis }, areaStyle: { color: th.grid } },
        handleStyle: { color: th.surface, borderColor: th.axis }, moveHandleSize: 0, textStyle: { color: th.muted, fontSize: 11 } }],
      tooltip: { ...baseTooltip(th), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (+v).toFixed(1) },
      xAxis: { type: 'category', data: periods, ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(th) },
      series: [{ name: mLabel, type: 'bar', data: vol, barMaxWidth: 28, itemStyle: { color: series(0), borderRadius: [4, 4, 0, 0] } }],
    }, true);

    // zones over time (server-side aggregation using current zone settings)
    const kind = s.zoneKind;
    const zt = objects(await api(`zones?family=${s.family}&group=${s.group}&kind=${kind}`));
    const nZ = (kind === 'hr' ? Z.hrFloors.length : Z.speedFloors.length) + 1;
    const mat = Array.from({ length: nZ }, () => new Array(periods.length).fill(0));
    const totals = new Array(nZ).fill(0);
    for (const r of zt) {
      const p = s.group === 'week' ? sqliteWeekToMonday(r.period) : r.period;
      const i = idx.get(p);
      if (i == null) continue;
      mat[r.zone][i] += r.secs;
      totals[r.zone] += r.secs;
    }
    const names = kind === 'hr' ? Z.hrNames : Z.paceNames;
    const labels = kind === 'hr' ? Z.hrLabels : Z.paceLabels;
    const colSum = periods.map((_, i) => mat.reduce((a, z) => a + z[i], 0));
    const firstZone = kind === 'hr' ? 0 : 1; // pace zone 0 is empty by construction
    zoneChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 40, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      legend: { top: 0, textStyle: { color: th.ink2 } },
      tooltip: { ...baseTooltip(th), trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps) => `<b>${ps[0].axisValue}</b><br>` + ps.slice().reverse().map((p) => {
          const secs = mat[p.seriesIndex + firstZone][p.dataIndex];
          return `${p.marker}${p.seriesName}: ${fmtDur(secs)} (${(100 * secs / (colSum[p.dataIndex] || 1)).toFixed(0)}%)`;
        }).join('<br>') },
      xAxis: { type: 'category', data: periods, ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', max: s.zonePct ? 100 : null, ...baseAxis(th),
        axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => (s.zonePct ? v + '%' : (v / 3600).toFixed(0) + ' h') } },
      series: mat.slice(firstZone).map((zs, k) => {
        const z = k + firstZone;
        return {
          name: z === 0 ? names[0] : `Z${z} ${names[z]}`, type: 'bar', stack: 'z', barMaxWidth: 28,
          itemStyle: { color: zoneColor(z), borderColor: th.surface, borderWidth: 1 },
          data: zs.map((v, i) => (s.zonePct ? (colSum[i] ? 100 * v / colSum[i] : 0) : v)),
        };
      }),
    }, true);


    // aerobic efficiency: metres per heartbeat (GAP-based where available), median per period
    const eff = periods.map(() => []);
    for (const r of rows) {
      if (!r.avg_hr || !(r.avg_gap_speed || r.avg_moving_speed) || (r.moving_duration || 0) < 900) continue;
      const i = idx.get(periodKey(r.start_local, s.group));
      if (i != null) eff[i].push((r.avg_gap_speed || r.avg_moving_speed) * 60 / r.avg_hr);
    }
    const med = (xs) => { if (!xs.length) return null; const t = [...xs].sort((a, b) => a - b); return t[t.length >> 1]; };
    effChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 16, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => (v == null ? '–' : (+v).toFixed(2) + ' m/beat') },
      xAxis: { type: 'category', data: periods, ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...baseAxis(th) },
      series: [{ name: 'Median efficiency', type: 'line', connectNulls: true, symbolSize: 6, data: eff.map(med),
        lineStyle: { width: 2, color: series(0) }, itemStyle: { color: series(0) } }],
    }, true);

    // training load: daily sums → acute (7 d) and chronic (28 d) exponentially weighted averages
    const dayLoad = new Map();
    for (const r of acts) {
      if (s.family !== 'all' && r.parent_type !== s.family) continue;
      const d = r.start_local.slice(0, 10);
      dayLoad.set(d, (dayLoad.get(d) || 0) + (r.training_load || 0));
    }
    const days = allPeriods(new Date(Date.parse(fromIso) - 60 * 86400e3).toISOString().slice(0, 10), today, 'day');
    let atl = 0, ctl = 0;
    const atlS = [], ctlS = [];
    for (const d of days) {
      const L = dayLoad.get(d) || 0;
      atl += (L - atl) * (1 - Math.exp(-1 / 7));
      ctl += (L - ctl) * (1 - Math.exp(-1 / 28));
      if (d >= fromIso) { atlS.push([d, atl * 7]); ctlS.push([d, ctl * 7]); }
    }
    loadChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 30, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      legend: { top: 0, textStyle: { color: th.ink2 } },
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => (+v).toFixed(0) },
      xAxis: { type: 'time', ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', ...baseAxis(th) },
      series: [
        { name: 'Acute load (7 d)', type: 'line', symbol: 'none', data: atlS, lineStyle: { width: 2, color: series(1) }, itemStyle: { color: series(1) } },
        { name: 'Chronic load (28 d)', type: 'line', symbol: 'none', data: ctlS, lineStyle: { width: 2, color: series(0) }, itemStyle: { color: series(0) } },
      ],
    }, true);

    // conditions-adjusted fitness (running model, see gdi_models.nim)
    const refHr = +s.refHr || 140;
    const runs = acts.filter((r) => r.parent_type === 'running' && r.ref_pace != null && r.start_local.slice(0, 10) >= fromIso)
      .sort((p, q) => (p.start_local < q.start_local ? -1 : 1));
    // ref_pace is stored at 140 bpm; shift to the chosen HR with the run's own model slope when it differs
    const refAt = (r) => {
      if (refHr === 140 || !r.coef) return r.ref_pace;
      const cf = typeof r.coef === 'string' ? JSON.parse(r.coef) : r.coef;
      return 1000 / (cf[0] + cf[1] * refHr + cf[2] * 0.5);
    };
    const pts = runs.map((r) => [Date.parse(r.start_local), refAt(r), r.name, r.id]).filter((p) => isFinite(p[1]) && p[1] > 0);
    const roll = pts.map((p, i) => [p[0], median(pts.slice(Math.max(0, i - 9), i + 1).map((q) => q[1]))]);
    const timeAxis = { type: 'time', ...baseAxis(th), splitLine: { show: false } };
    fitChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 30, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      legend: { top: 0, textStyle: { color: th.ink2 } },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `${p.seriesIndex === 0 ? `<b>${p.data[2]}</b><br>` : 'Median of last 10 runs<br>'}${new Date(p.data[0]).toISOString().slice(0, 10)} · ${fmtDur(p.data[1])} /km` },
      xAxis: timeAxis,
      yAxis: { type: 'value', inverse: true, scale: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => fmtDur(v) } },
      series: [
        { name: 'Per run (model of the preceding 120 days)', type: 'scatter', symbolSize: 5, itemStyle: { color: series(0), opacity: 0.45 }, data: pts },
        { name: 'Median of last 10 runs', type: 'line', symbol: 'none', lineStyle: { width: 2.5, color: series(0) }, itemStyle: { color: series(0) }, data: roll },
      ],
    }, true);
    const devs = runs.filter((r) => r.exp_delta != null).map((r) => [Date.parse(r.start_local), r.exp_delta, r.name, r.id]);
    const noise = median(acts.filter((r) => r.exp_delta != null).map((r) => Math.abs(r.exp_delta))) || 17;
    devChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 16, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `<b>${p.data[2]}</b><br>${new Date(p.data[0]).toISOString().slice(0, 10)} · ${p.data[1] > 0 ? '+' : '−'}${Math.abs(Math.round(p.data[1]))} s/km vs expected` },
      xAxis: timeAxis,
      yAxis: { type: 'value', inverse: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => `${v > 0 ? '+' : ''}${v}` } },
      series: [{ type: 'scatter', symbolSize: 6, data: devs,
        itemStyle: { color: (p) => (Math.abs(p.data[1]) > 1.5 * noise ? series(1) : series(0)), opacity: 0.75 },
        markArea: { silent: true, itemStyle: { color: th.grid, opacity: 0.6 }, data: [[{ yAxis: -noise }, { yAxis: noise }]] },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: th.axis, width: 1, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] } }],
    }, true);
    // aerobic decoupling of steady runs
    const minDur = (+s.decMin || 60) * 60;
    const decRuns = acts.filter((r) => r.parent_type === 'running' && r.decoupling_steady && r.decoupling != null &&
      (r.moving_duration || 0) >= minDur && r.start_local.slice(0, 10) >= fromIso).sort((p, q) => (p.start_local < q.start_local ? -1 : 1));
    const decPts = decRuns.map((r) => [Date.parse(r.start_local), r.decoupling, r.name, r.id, r.moving_duration]);
    const decRoll = decPts.map((p, i) => [p[0], median(decPts.slice(Math.max(0, i - 7), i + 1).map((q) => q[1]))]);
    decChart.setOption({
      animation: false, grid: { left: 56, right: 16, top: 30, bottom: 36 }, dataZoom: [{ type: 'inside' }],
      legend: { top: 0, textStyle: { color: th.ink2 } },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => p.seriesIndex === 0
        ? `<b>${p.data[2]}</b><br>${new Date(p.data[0]).toISOString().slice(0, 10)} · ${fmtDur(p.data[4])}<br>decoupling ${p.data[1].toFixed(1)} %`
        : `median of last 8: ${(+p.data[1]).toFixed(1)} %` },
      xAxis: timeAxis,
      yAxis: { type: 'value', ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => `${v} %` } },
      series: [
        { name: `Steady runs ≥ ${minDur / 60} min (size = duration)`, type: 'scatter', data: decPts,
          symbolSize: (d) => 4 + Math.min(10, d[4] / 1200), itemStyle: { color: series(0), opacity: 0.6 },
          markArea: { silent: true, itemStyle: { color: th.grid, opacity: 0.6 }, data: [[{ yAxis: -5 }, { yAxis: 5 }]] },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: th.axis, width: 1, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] } },
        { name: 'Median of last 8', type: 'line', symbol: 'none', data: decRoll, lineStyle: { width: 2.5, color: series(0) }, itemStyle: { color: series(0) } },
      ],
    }, true);
    decCount.textContent = `${decPts.length} steady runs in range`;
    garmin.draw(fromIso).then(() => { if (zoom) applyRange(zoom); }).catch((e) => console.error(e));
    fitTitle.textContent = `Pace at ${refHr} bpm (grade-adjusted, flat road, 30 min into the run)`;

    ctx = { s, periods, fromIso, today, mat, names, labels, kind, firstZone };
    applyRange(null);
  }

  // ── zoom sync + range-dependent summaries ──
  const famOk = (a) => ctx.s.family === 'all' || a.parent_type === ctx.s.family;
  function visibleRange() {
    return zoom ?? { from: ctx.fromIso, to: ctx.today };
  }
  function idxRange(range) {
    const P = ctx.periods;
    let si = P.findIndex((p) => periodRange(p, ctx.s.group)[1] >= range.from);
    let ei = P.length - 1;
    while (ei > 0 && periodRange(P[ei], ctx.s.group)[0] > range.to) ei--;
    if (si < 0) si = 0;
    return [si, Math.max(si, ei)];
  }
  /** Apply a date range to all charts (except `source`) and refresh tiles / zone totals. */
  function applyRange(range, source = null) {
    zoom = range;
    const r = visibleRange();
    if (range) {
      syncing = true;
      const [si, ei] = idxRange(r);
      for (const c of catCharts) if (c !== source) c.dispatchAction({ type: 'dataZoom', startValue: si, endValue: ei });
      for (const c of timeCharts) if (c !== source) c.dispatchAction({ type: 'dataZoom', startValue: Date.parse(r.from), endValue: Date.parse(r.to) + 86399e3 });
      syncing = false;
    }
    // tiles for the visible range
    const rows = acts.filter((a) => famOk(a) && a.start_local.slice(0, 10) >= r.from && a.start_local.slice(0, 10) <= r.to);
    const tot = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
    const [si, ei] = idxRange(r);
    const nPeriods = ei - si + 1;
    tilesEl.replaceChildren(
      tile('Activities', rows.length), tile('Distance', fmtKm(tot('distance'), 0), 'km'),
      tile('Moving time', fmtDur(tot('moving_duration'))), tile('Ascent', fmtNum(tot('elev_gain')), 'm'),
      tile('Training load', fmtNum(tot('training_load'))),
      tile('Avg per ' + ctx.s.group, fmtKm(tot('distance') / Math.max(1, nPeriods), 1), 'km'));
    // zone totals for the visible periods
    const totals = ctx.mat.map((z) => z.slice(si, ei + 1).reduce((a, b) => a + b, 0));
    const fz = ctx.firstZone;
    const kindLabel = ctx.kind === 'hr' ? 'heart rate' : ctx.kind === 'gap' ? 'grade-adjusted pace' : 'pace';
    zoneTotalEl.replaceChildren(zoneBlock(`Total ${zoom ? 'in view' : 'for range'} — ${kindLabel}`,
      totals.slice(fz), ctx.names.slice(fz), ctx.labels.slice(fz), fz));
    zoomBar.replaceChildren(...[
      h('span', { class: 'sub' }, zoom ? `Showing ${r.from} → ${r.to}` : 'Scroll or drag on a chart to zoom; click a bar or point to list its activities.'),
      h('button', { onclick: () => select(r, zoom ? `${r.from} → ${r.to}` : 'whole range') }, 'Activities in view'),
      zoom ? h('button', { onclick: resetZoom }, 'Reset zoom') : null].filter(Boolean));
  }
  function resetZoom() {
    syncing = true;
    for (const c of [...catCharts, ...timeCharts]) c.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    syncing = false;
    applyRange(null);
  }
  function rangeOfChart(c) {
    const [a, b] = c.getModel().getComponent('xAxis', 0).axis.scale.getExtent();
    if (timeCharts.includes(c)) return { from: isoOf(a), to: isoOf(b) };
    const P = ctx.periods;
    const si = Math.max(0, Math.ceil(a)), ei = Math.min(P.length - 1, Math.floor(b));
    return { from: periodRange(P[si], ctx.s.group)[0], to: periodRange(P[ei], ctx.s.group)[1] };
  }
  for (const c of [...catCharts, ...timeCharts]) {
    c.on('datazoom', () => {
      if (syncing || !ctx) return;
      const r = rangeOfChart(c);
      const full = r.from <= ctx.fromIso && r.to >= ctx.today;
      applyRange(full ? null : r, c);
    });
    // click anywhere in a column / at a day → list its activities
    let hover = null;
    c.on('updateAxisPointer', (ev) => { hover = ev.axesInfo?.[0]?.value ?? null; });
    c.getZr().on('click', () => {
      if (hover == null || !ctx) return;
      const p = timeCharts.includes(c) ? periodKeyOf(isoOf(hover)) : ctx.periods[hover];
      if (!p) return;
      const [from, to] = periodRange(p, ctx.s.group);
      select({ from, to }, ctx.s.group === 'week' ? `week of ${from}` : p);
    });
  }
  const periodKeyOf = (iso) => periodKey(iso, ctx.s.group);
  for (const c of [fitChart, devChart, decChart]) c.on('click', (p) => { if (p.seriesType === 'scatter') location.hash = `#/activity/${p.data[3]}`; });

  // ── drill-down: activities behind a period / the zoomed range ──
  function select(range, label) {
    const fam = ctx.s.family;
    const rows = acts.filter((a) => famOk(a) && a.start_local.slice(0, 10) >= range.from && a.start_local.slice(0, 10) <= range.to);
    const tot = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
    const q = new URLSearchParams({ family: fam, from: range.from, to: range.to });
    const famOf = (r) => r.parent_type;
    selectionEl.hidden = false;
    selectionEl.replaceChildren(
      h('div', { class: 'filters', style: 'margin-bottom:8px;align-items:baseline' },
        h('h2', { style: 'margin:0' }, `Activities — ${label}`),
        h('span', { class: 'sub' }, `${rows.length} activities · ${fmtKm(tot('distance'), 1)} km · ${fmtDur(tot('moving_duration'))} · load ${fmtNum(tot('training_load'))}`),
        h('a', { href: `#/activities?${q}` }, 'Open in Activities ↗'),
        h('button', { style: 'margin-left:auto', onclick: () => { selectionEl.hidden = true; } }, 'Close')),
      rows.length ? dataTable(rows, [
        { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v, true), link: (r) => `#/activity/${r.id}` },
        { key: 'name', label: 'Name', left: true, cls: 'name', link: (r) => `#/activity/${r.id}` },
        { key: 'type_key', label: 'Type', left: true, fmt: TYPE_LABEL },
        { key: 'distance', label: 'km', fmt: (v) => (v ? fmtKm(v) : '–') },
        { key: 'moving_duration', label: 'Moving', fmt: fmtDur },
        { key: 'avg_moving_speed', label: 'Pace/Speed', fmt: (v, r) => (r.distance ? `${fmtSpeedFor(famOf(r), v)} ${speedUnit(famOf(r))}` : '–') },
        { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
        { key: 'elev_gain', label: 'Ascent', fmt: (v) => fmtNum(v) },
        { key: 'training_load', label: 'Load', fmt: (v) => fmtNum(v) },
        { key: 'aerobic_te', label: 'TE', fmt: (v) => fmtNum(v, 1) },
      ], { sortKey: 'start_local', sortDesc: true, id: 'dash-selection' }) : h('div', { class: 'empty' }, 'No activities in this period.'));
    selectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const s = state.get();
  const fitTitle = h('h3', {});
  const decCount = h('span', { class: 'muted' });
  const decMinSel = h('label', { style: 'flex-direction:row;align-items:center;gap:6px' }, 'min. duration',
    segmented([['45', '45 min'], ['60', '60 min'], ['90', '90 min']], String(s.decMin || 60), (v) => { state.set({ decMin: +v }); draw(); }));
  const refHrInput = h('label', { style: 'flex-direction:row;align-items:center;gap:6px' }, 'reference HR',
    (() => { const el = h('input', { type: 'number', min: 100, max: 190, step: 5, value: s.refHr || 140, style: 'width:70px' });
      el.addEventListener('change', () => { state.set({ refHr: +el.value }); draw(); }); return el; })());
  drawControls();
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Performance')),
    controls, tilesEl, zoomBar,
    h('div', { class: 'card', style: 'margin-bottom:16px' },
      h('div', { class: 'filters', style: 'margin-bottom:4px' }, h('h2', { style: 'margin:0' }, 'Volume'),
        segmented([['distance', 'Distance'], ['time', 'Time'], ['ascent', 'Ascent'], ['load', 'Load'], ['count', 'Count']], s.metric, (v) => { state.set({ metric: v }); draw(); })),
      volEl),
    h('div', { class: 'grid', style: 'grid-template-columns:minmax(0,3fr) minmax(0,1fr);margin-bottom:16px' },
      h('div', { class: 'card' },
        h('div', { class: 'filters', style: 'margin-bottom:4px' }, h('h2', { style: 'margin:0' }, 'Time in zone'),
          segmented([['hr', 'Heart rate'], ['pace', 'Pace'], ['gap', 'Grade-adj. pace']], s.zoneKind, (v) => { state.set({ zoneKind: v }); draw(); }),
          segmented([[true, '%'], [false, 'hours']], s.zonePct, (v) => { state.set({ zonePct: v }); draw(); })),
        zoneEl),
      h('div', { class: 'card' }, zoneTotalEl)),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h2', {}, 'Aerobic efficiency'),
        h('div', { class: 'muted', style: 'font-size:12px' }, 'Median metres per heartbeat (grade-adjusted speed ÷ HR) of activities ≥ 15 min. Higher = fitter.'), effEl),
      h('div', { class: 'card' }, h('h2', {}, 'Training load'),
        h('div', { class: 'muted', style: 'font-size:12px' }, 'Garmin activity load, exponentially weighted (weekly scale).'), loadEl)),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'filters', style: 'margin-bottom:4px;align-items:baseline' },
        h('h2', { style: 'margin:0' }, 'Conditions-adjusted running fitness'), refHrInput),
      h('div', { class: 'grid cols-2' },
        h('div', {}, fitTitle, h('div', { class: 'muted', style: 'font-size:12px' }, 'From each run\'s expected-pace model (HR, drift, terrain). Lower = fitter. Click a dot to open the run.'), fitEl),
        h('div', {}, h('h3', {}, 'Each run vs expected (s/km, − = faster)'),
          h('div', { class: 'muted', style: 'font-size:12px' }, 'Grey band: typical run-to-run scatter. Orange: clearly outside it.'), devEl))),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'filters', style: 'margin-bottom:4px;align-items:baseline' },
        h('h2', { style: 'margin:0' }, 'Aerobic endurance: decoupling'), decMinSel, decCount),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Efficiency (grade-adjusted speed ÷ HR) lost from the 1st to the 2nd half of steady runs, after a 10 min warm-up. Grey band ±5 %: well coupled. Rising values on long runs point to limited aerobic endurance (or heat, fuelling, fatigue).'),
      decEl),
    garmin.el,
    selectionEl);
  await draw();
  return () => charts.forEach((c) => c.dispose());
}
