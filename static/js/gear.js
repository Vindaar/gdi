// Gear: distance per shoe (ours and Garmin's running total vs its usage
// target), when each pair was used, and how runs in it compare — the
// expected-pace delta already accounts for HR, drift and terrain.
import {
  api, objects, h, dataTable, fmtDur, fmtNum, fmtPace, fmtDate, remember, segmented, echart,
  chartTheme, baseAxis, baseTooltip, blueRamp,
} from './util.js';

const state = remember('gear', { show: 'active' });
const median = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

export async function gearPage(app) {
  const d = await api('gear');
  const uses = objects(d.uses);
  const chartEl = h('div', { class: 'chart tall' });
  const chart = echart(chartEl);
  const tableBox = h('div', {});
  const showBox = h('span', {});

  // aggregate per gear item
  const byUuid = new Map();
  for (const u of uses) {
    if (!byUuid.has(u.uuid)) byUuid.set(u.uuid, []);
    byUuid.get(u.uuid).push(u);
  }
  const items = [...byUuid.entries()].map(([uuid, us]) => {
    const g = d.gear[uuid] || {};
    const runs = us.filter((u) => u.parent_type === 'running');
    const runKm = runs.reduce((a, u) => a + (u.distance || 0), 0);
    const trailKm = runs.filter((u) => u.type_key === 'trail_running').reduce((a, u) => a + (u.distance || 0), 0);
    const steady = runs.filter((u) => u.decoupling_steady && u.decoupling != null);
    return {
      uuid, name: us[us.length - 1].name || g.brand || uuid.slice(0, 8), status: (g.status || '').toLowerCase(),
      first: us[0].start_local, last: us[us.length - 1].start_local, n: us.length, nRuns: runs.length,
      km: us.reduce((a, u) => a + (u.distance || 0), 0), runKm,
      garminKm: g.distanceUsedMeters ?? null, maxKm: g.maxUsageDistanceMeters || null,
      delta: median(runs.map((u) => u.delta)), nDelta: runs.filter((u) => u.delta != null).length,
      hr: median(runs.map((u) => u.avg_hr)), gap: median(runs.map((u) => u.avg_gap_speed)),
      cad: median(runs.map((u) => u.avg_cadence)), stride: median(runs.map((u) => u.avg_stride)),
      apk: median(runs.map((u) => u.ascent_per_km)), trail: runKm ? trailKm / runKm : null,
      dec: median(steady.map((u) => u.decoupling)), nDec: steady.length,
    };
  });

  function render() {
    const show = state.get().show;
    const list = items.filter((g) => show === 'all' || g.status !== 'retired');
    showBox.replaceChildren(segmented([['active', 'Active'], ['all', 'All incl. retired']], show, (v) => { state.set({ show: v }); render(); }));
    const usage = (g) => {
      const used = g.garminKm ?? g.km;
      if (!g.maxKm) return h('span', {}, `${fmtNum(used / 1000)} km`);
      const pct = Math.min(1, used / g.maxKm);
      const over = used > g.maxKm;
      return h('span', { class: `usage${over ? ' over' : ''}`, title: `${fmtNum(used / 1000)} of ${fmtNum(g.maxKm / 1000)} km (Garmin's target for this pair); ${fmtNum(g.km / 1000)} km of linked activities in this database` },
        h('span', { class: 'usage-bar' }, h('span', { style: `width:${(100 * pct).toFixed(0)}%` })),
        ` ${fmtNum(used / 1000)} / ${fmtNum(g.maxKm / 1000)} km`, over ? h('span', { class: 'muted' }, ' ⚠ over target') : null);
    };
    tableBox.replaceChildren(dataTable(list, [
      { key: 'name', label: 'Gear', left: true, cls: 'name', title: (r) => r.name,
        link: (r) => `#/activities?q=${encodeURIComponent(r.name)}` },
      { key: 'status', label: 'Status', left: true },
      { key: 'garminKm', label: 'Used (Garmin) / target', fmt: (v, r) => usage(r), sortVal: (r) => r.garminKm ?? r.km },
      { key: 'nRuns', label: 'Runs' },
      { key: 'first', label: 'First', left: true, fmt: (v) => fmtDate(v) },
      { key: 'last', label: 'Last', left: true, fmt: (v) => fmtDate(v) },
      { key: 'delta', label: 'vs exp.', fmt: (v, r) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`),
        title: (r) => (r.delta == null ? null : `median of ${r.nDelta} runs: actual − expected pace (s/km) at their HR and terrain; − = faster`) },
      { key: 'dec', label: 'Decoupl.', fmt: (v, r) => (v == null ? '–' : `${fmtNum(v, 1)} %`), title: (r) => (r.nDec ? `median of ${r.nDec} steady runs` : null) },
      { key: 'hr', label: 'HR', fmt: (v) => fmtNum(v) },
      { key: 'gap', label: 'GAP', fmt: (v) => (v ? fmtPace(v) : '–') },
      { key: 'cad', label: 'Cad', fmt: (v) => fmtNum(v) },
      { key: 'stride', label: 'Stride cm', fmt: (v) => fmtNum(v) },
      { key: 'apk', label: 'm/km', fmt: (v) => fmtNum(v, 1) },
      { key: 'trail', label: 'Trail', fmt: (v) => (v == null ? '–' : `${fmtNum(100 * v)} %`) },
    ], { sortKey: 'last', sortDesc: true, id: 'gear' }));
    drawChart(list);
  }

  // shoe × month heatmap of distance (one sequential hue; no categorical limit)
  function drawChart(list) {
    const th = chartTheme();
    const ids = new Set(list.map((g) => g.uuid));
    const order = [...list].sort((a, b) => (a.first < b.first ? -1 : 1));
    const months = [];
    const minM = order.length ? order[0].first.slice(0, 7) : null;
    if (minM) {
      let [y, m] = minM.split('-').map(Number);
      const end = new Date().toISOString().slice(0, 7);
      while (`${y}-${String(m).padStart(2, '0')}` <= end) { months.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
    }
    const mi = new Map(months.map((m, i) => [m, i]));
    const gi = new Map(order.map((g, i) => [g.uuid, i]));
    const cell = new Map();
    for (const u of uses) {
      if (!ids.has(u.uuid)) continue;
      const k = `${mi.get(u.start_local.slice(0, 7))},${gi.get(u.uuid)}`;
      cell.set(k, (cell.get(k) || 0) + (u.distance || 0) / 1000);
    }
    const data = [...cell.entries()].map(([k, v]) => [...k.split(',').map(Number), Math.round(v)]);
    const max = Math.max(1, ...data.map((x) => x[2]));
    chartEl.style.height = `${Math.max(220, 60 + 22 * order.length)}px`;
    chart.resize();
    chart.setOption({
      animation: false, grid: { left: 190, right: 70, top: 10, bottom: 40 },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `<b>${order[p.data[1]].name}</b><br>${months[p.data[0]]}: ${p.data[2]} km` },
      xAxis: { type: 'category', data: months, ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'category', data: order.map((g) => g.name), ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, width: 175, overflow: 'truncate' } },
      visualMap: { min: 0, max, calculable: false, orient: 'vertical', right: 4, top: 'middle', itemHeight: 120, inRange: { color: blueRamp() },
        text: [`${max} km`, '0'], textStyle: { color: th.ink2, fontSize: 11 } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: th.surface, borderWidth: 1 } }],
    }, true);
  }

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Gear'), showBox,
      h('span', { class: 'sub' }, 'Medians over runs in each pair. "vs exp." compares with the expected-pace model, so HR, drift and terrain are already accounted for.')),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, tableBox),
    h('div', { class: 'card' }, h('h2', {}, 'Distance per month'), chartEl));
  render();
  return () => chart.dispose();
}
