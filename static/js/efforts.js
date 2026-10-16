// Best efforts: the fastest N-metre stretch inside every activity, for a
// chosen distance. Standard distances are precomputed; any other distance is
// computed on the server from the streams.
import {
  api, objects, h, dataTable, fmtDur, fmtKm, fmtNum, fmtDate, fmtPace, fmtSpeedFor, speedUnit,
  usesPace, TYPE_LABEL, FAMILIES, remember, fmtDistanceLabel, echart, chartTheme, baseAxis,
  baseTooltip, series, segmented, dqBadge,
} from './util.js';
import { durationPage } from './curves.js';

const PRESETS = [400, 1000, 1609.344, 3000, 5000, 10000, 15000, 21097.5, 30000, 42195];
const state = remember('efforts', { distance: 5000, family: 'running', type: '', from: '', to: '', maxAscent: '', hideFlagged: false });

const tabState = remember('effortsTab', { tab: 'distance' });

export async function effortsPage(app) {
  const urlTab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  if (urlTab) tabState.set({ tab: urlTab });
  const tabs = segmented([['distance', 'By distance'], ['duration', 'By duration']], tabState.get().tab,
    (v) => { tabState.set({ tab: v }); location.hash = `#/efforts?tab=${v}`; });
  if (tabState.get().tab === 'duration') return durationPage(app, tabs);
  const s = state.get();
  const famSel = h('select', {}, FAMILIES.slice(0, 4).map((f) => h('option', { value: f, selected: s.family === f }, f)));
  const custom = h('input', { type: 'number', step: '0.1', min: 0.1, placeholder: 'km', value: PRESETS.includes(s.distance) ? '' : s.distance / 1000 });
  const typeSel = h('select', {});
  const from = h('input', { type: 'date', value: s.from });
  const to = h('input', { type: 'date', value: s.to });
  const maxAscent = h('input', { type: 'number', min: 0, step: 1, value: s.maxAscent, placeholder: 'm/km' });
  const hideFlagged = h('input', { type: 'checkbox', checked: !!s.hideFlagged });
  const presetBox = h('span', {});
  const title = h('h2', {});
  const tableBox = h('div', {});
  const chartEl = h('div', { class: 'chart' });
  const chart = echart(chartEl);
  let rows = [];

  function drawPresets() {
    presetBox.replaceChildren(segmented(PRESETS.map((d) => [d, fmtDistanceLabel(d)]),
      state.get().distance, (d) => { custom.value = ''; state.set({ distance: d }); load(); }));
  }

  async function load() {
    const { distance, family } = state.get();
    tableBox.replaceChildren(h('div', { class: 'empty' }, 'Computing…'));
    const t = await api(`efforts?distance=${distance}&family=${family}`);
    rows = objects(t);
    const types = [...new Set(rows.map((r) => r.type_key))].sort();
    typeSel.replaceChildren(h('option', { value: '' }, 'Any type'),
      types.map((x) => h('option', { value: x, selected: state.get().type === x }, TYPE_LABEL(x))));
    render();
  }

  function render() {
    const f = { type: typeSel.value, from: from.value, to: to.value, maxAscent: maxAscent.value, hideFlagged: hideFlagged.checked };
    state.set(f);
    const { distance, family } = state.get();
    const filtered = rows.filter((r) =>
      (!f.type || r.type_key === f.type) &&
      (!f.from || r.start_local >= f.from) &&
      (!f.to || r.start_local.slice(0, 10) <= f.to) &&
      (f.maxAscent === '' || (r.elev_gain ?? 0) / (distance / 1000) <= +f.maxAscent) &&
      (!f.hideFlagged || !r.dq_flags));
    // rank by time
    const ranked = [...filtered].sort((a, b) => a.time - b.time).map((r, i) => ({ ...r, rank: i + 1, speed: distance / r.time }));
    title.textContent = `${fmtDistanceLabel(distance)} — ${ranked.length} efforts`;
    tableBox.replaceChildren(dataTable(ranked, [
      { key: 'rank', label: '#', defaultAsc: true },
      { key: 'time', label: 'Time', fmt: fmtDur, defaultAsc: true },
      { key: 'speed', label: usesPace(family) ? 'Pace' : 'Speed', fmt: (v) => `${fmtSpeedFor(family, v)} ${speedUnit(family)}` },
      { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v) },
      { key: 'name', label: 'Activity', left: true, cls: 'name', link: (r) => `#/activity/${r.id}`, after: (r) => dqBadge(r.dq_flags) },
      { key: 'type_key', label: 'Type', left: true, fmt: TYPE_LABEL },
      { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
      { key: 'elev_gain', label: '↑ m', fmt: (v) => fmtNum(v) },
      { key: 'start_dist', label: 'at km', fmt: (v) => fmtKm(v, 1) },
      { key: 'total_distance', label: 'of km', fmt: (v) => fmtKm(v, 1) },
      { key: 'w_temp', label: '°C', fmt: (v) => fmtNum(v) },
    ], { sortKey: 'rank', sortDesc: false, pageSize: 50, id: 'efforts' }));

    // progression chart: every effort over time + running personal best
    const th = chartTheme();
    const byDate = [...filtered].sort((a, b) => (a.start_local < b.start_local ? -1 : 1));
    let best = Infinity;
    const pb = [];
    for (const r of byDate) if (r.time < best) { best = r.time; pb.push([r.start_local.slice(0, 10), r.time]); }
    if (pb.length) pb.push([new Date().toISOString().slice(0, 10), best]);
    chart.setOption({
      animation: false,
      grid: { left: 64, right: 20, top: 30, bottom: 40 },
      tooltip: { ...baseTooltip(th), trigger: 'item',
        formatter: (p) => p.seriesIndex === 0
          ? `<b>${fmtDur(p.data[1])}</b> · ${p.data[0]}<br>${p.data[2]}<br>HR ${fmtNum(p.data[3])}` : `PB ${fmtDur(p.data[1])} since ${p.data[0]}` },
      legend: { top: 0, textStyle: { color: th.ink2 }, data: ['Effort', 'Personal best'] },
      xAxis: { type: 'time', ...baseAxis(th), splitLine: { show: false } },
      yAxis: { type: 'value', inverse: true, scale: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => fmtDur(v) } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series: [
        { name: 'Effort', type: 'scatter', symbolSize: 8, itemStyle: { color: series(0), opacity: 0.6, borderColor: th.surface, borderWidth: 1 },
          data: byDate.map((r) => [r.start_local.slice(0, 10), r.time, r.name, r.avg_hr, r.id]) },
        { name: 'Personal best', type: 'line', step: 'end', symbol: 'none', lineStyle: { width: 2, color: series(1) }, data: pb },
      ],
    }, true);
  }
  chart.on('click', (p) => { if (p.seriesIndex === 0) location.hash = `#/activity/${p.data[4]}`; });

  famSel.addEventListener('change', () => { state.set({ family: famSel.value, type: '' }); load(); });
  custom.addEventListener('change', () => {
    const km = parseFloat(custom.value);
    if (km > 0) { state.set({ distance: Math.round(km * 1000 * 10) / 10 }); drawPresets(); load(); }
  });
  for (const el of [typeSel, from, to, hideFlagged]) el.addEventListener('change', render);
  maxAscent.addEventListener('input', render);
  drawPresets();

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Best efforts'), tabs,
      h('span', { class: 'sub' }, 'Fastest stretch of the given distance inside each activity (elapsed time).')),
    h('div', { class: 'filters' }, h('label', {}, 'Sport', famSel), h('label', {}, 'Distance', presetBox),
      h('label', {}, 'Custom km', custom), h('label', {}, 'Type', typeSel),
      h('label', {}, 'From', from), h('label', {}, 'To', to), h('label', {}, 'Max ascent / km in effort', maxAscent),
      h('label', { title: 'distance is glitch-cleaned either way; this drops activities flagged for any data issue' }, 'Data quality',
        h('span', { class: 'check' }, hideFlagged, 'hide flagged'))),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h2', {}, 'Progression'), chartEl),
    h('div', { class: 'card' }, title, tableBox));
  await load();
  return () => chart.dispose();
}
