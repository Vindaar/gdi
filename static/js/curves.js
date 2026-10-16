// Best efforts by duration (mean-maximal curves) + critical-speed estimate.
import {
  api, postJson, objects, h, dataTable, fmtDur, fmtDate, fmtNum, remember, echart, chartTheme,
  baseAxis, baseTooltip, series, segmented, FAMILIES, clearCache,
} from './util.js';

const state = remember('curves', { metric: 'speed', family: 'running', periodA: '90', periodB: 'prev' });

const fmtSecs = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${+(s / 60).toFixed(1)} min` : `${+(s / 3600).toFixed(1)} h`);
const DURATIONS = [10, 20, 30, 60, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800];
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** period key → [from, to] ISO dates */
function periodRange(key, relativeTo = null) {
  const today = Date.now();
  if (/^\d{4}$/.test(key)) return [`${key}-01-01`, `${key}-12-31`];
  if (key === 'all') return ['', ''];
  const days = +key;
  return [day(today - days * 86400e3), day(today)];
}
function previousOf(a) {
  if (!a[0]) return null;
  const from = Date.parse(a[0]), to = Date.parse(a[1]);
  const len = to - from;
  return [day(from - len - 86400e3), day(from - 86400e3)];
}

/** two-parameter critical-speed model, D = CS·t + D′, fitted on 3–20 min bests */
export function fitCriticalSpeed(rows) {
  const pts = rows.filter((r) => r.duration >= 180 && r.duration <= 1200).map((r) => [r.duration, r.value * r.duration]);
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const cs = sxy / sxx, dprime = my - cs * mx;
  const ssr = pts.reduce((a, p) => a + (p[1] - (cs * p[0] + dprime)) ** 2, 0), sst = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
  // relative speed error of the fit (more telling than R² on distance, which is ~1 by construction)
  const relErr = Math.sqrt(pts.reduce((a, p) => a + ((cs + dprime / p[0]) / (p[1] / p[0]) - 1) ** 2, 0) / n);
  return { cs, dprime, r2: 1 - ssr / sst, relErr, n };
}

export async function durationPage(app, tabs) {
  const chartEl = h('div', { class: 'chart tall' });
  const chart = echart(chartEl);
  const controls = h('div', { class: 'filters' });
  const csBox = h('div', {});
  const tableBox = h('div', {});
  const info = h('div', { class: 'muted', style: 'margin-top:6px' });

  function drawControls() {
    const s = state.get();
    const years = [];
    for (let y = new Date().getFullYear(); y >= 2012; y--) years.push([String(y), String(y)]);
    const sel = (key, opts, val) => {
      const el = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
      el.addEventListener('change', () => { state.set({ [key]: el.value }); load(); });
      return el;
    };
    controls.replaceChildren(
      h('label', {}, 'Sport', sel('family', FAMILIES.slice(0, 3).map((f) => [f, f]), s.family)),
      h('label', {}, 'Metric', segmented([['speed', 'Pace'], ['gap', 'Grade-adj. pace'], ['power', 'Power']], s.metric, (v) => { state.set({ metric: v }); load(); })),
      h('label', {}, 'Period', sel('periodA', [['90', 'last 90 days'], ['182', 'last 6 months'], ['365', 'last 12 months'], ['all', 'all time'], ...years], s.periodA)),
      h('label', {}, 'Compare with', sel('periodB', [['', '—'], ['prev', 'previous period'], ['all', 'all time'], ...years], s.periodB)));
  }

  async function load() {
    const s = state.get();
    const isPace = s.metric !== 'power';
    const A = periodRange(s.periodA);
    const B = s.periodB === 'prev' ? previousOf(A) : s.periodB ? periodRange(s.periodB) : null;
    const q = (r) => `mmp?metric=${s.metric}&family=${s.family}&from=${r[0]}&to=${r[1]}`;
    const [ra, rb] = await Promise.all([api(q(A)).then(objects), B ? api(q(B)).then(objects) : Promise.resolve([])]);
    const label = (r, key) => (key === 'prev' ? `previous period (${r[0]} → ${r[1]})` : !r[0] ? 'all time' : /^\d{4}$/.test(key) ? key : `${r[0]} → ${r[1]}`);
    const nameA = label(A, s.periodA), nameB = B ? label(B, s.periodB) : null;
    const th = chartTheme();
    const y = (v) => (isPace ? 1000 / v : v);
    const fmtY = (v) => (isPace ? `${fmtDur(v)} /km` : `${Math.round(v)} W`);
    // category x axis (durations are roughly geometric, so this reads like a log axis)
    const toPts = (rows) => {
      const m = new Map(rows.map((r) => [r.duration, r]));
      return DURATIONS.map((d) => { const r = m.get(d); return r ? { value: y(r.value), name: r.name, date: r.start_local, id: r.id, dur: d } : null; });
    };
    const ser = [
      { name: nameA, type: 'line', symbol: 'circle', symbolSize: 7, data: toPts(ra), lineStyle: { width: 2.5, color: series(0, B ? 2 : 1) }, itemStyle: { color: series(0, B ? 2 : 1), borderColor: th.surface, borderWidth: 1.5 } },
    ];
    if (B) ser.push({ name: nameB, type: 'line', symbol: 'circle', symbolSize: 6, data: toPts(rb), lineStyle: { width: 2, color: series(1, 2) }, itemStyle: { color: series(1, 2), borderColor: th.surface, borderWidth: 1.5 } });

    // critical speed (pace metrics only)
    const cs = isPace ? fitCriticalSpeed(ra) : null;
    if (cs && cs.cs > 0) {
      const line = [];
      for (const t of DURATIONS) line.push(t >= 120 && t <= 3600 ? 1000 / (cs.cs + cs.dprime / t) : null);
      ser.push({ name: 'Critical-speed model', type: 'line', symbol: 'none', data: line, lineStyle: { width: 1.5, color: th.ink2 }, itemStyle: { color: th.ink2 }, tooltip: { show: false }, z: 1 });
    }
    chart.setOption({
      animation: false, grid: { left: 70, right: 24, top: 40, bottom: 50 },
      legend: { top: 0, textStyle: { color: th.ink2 } },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `<b>${fmtSecs(p.data.dur)}: ${fmtY(p.data.value)}</b><br>${p.seriesName}<br>${p.data.name || ''}<br>${fmtDate(p.data.date || '')}` },
      xAxis: { type: 'category', data: DURATIONS.map(fmtSecs), name: 'Duration', nameLocation: 'middle', nameGap: 30, boundaryGap: false, ...baseAxis(th) },
      yAxis: { type: 'value', inverse: isPace, scale: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => (isPace ? fmtDur(v) : v) } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series: ser,
    }, true);
    info.textContent = 'Best average over each duration from any activity in the period (elapsed time; GPS start-glitches and implausible strides excluded). Click a point to open the activity.';

    // CS card
    if (cs && cs.cs > 0) {
      const pace = 1000 / cs.cs;
      const s2 = await api('settings');
      const slowerThanLt = cs.cs < s2.thresholdSpeed;
      const shaky = cs.relErr > 0.03 || cs.dprime < 50 || cs.dprime > 600 || slowerThanLt;
      csBox.replaceChildren(h('div', { class: 'card', style: 'margin-bottom:16px' },
        h('h2', {}, `Critical speed: ${fmtDur(pace)} /km`),
        h('div', { class: 'sub' }, `D′ (distance you can run above critical speed) ≈ ${Math.round(cs.dprime)} m · fitted on ${cs.n} bests between 3 and 20 min (${nameA}) · fit error ${(cs.relErr * 100).toFixed(1)} %.`),
        h('p', { class: 'sub' }, `Critical speed is the boundary between sustainable and unsustainable intensity; it typically sits a little faster than lactate-threshold pace (about the pace of a 30–60 min race). ` +
          `Your current threshold setting is ${fmtDur(1000 / s2.thresholdSpeed)} /km.`),
        shaky ? h('p', { class: 'sub' }, '⚠ ' + (slowerThanLt ? 'This is slower than your current threshold pace, although critical speed normally lies a little faster — the period probably lacks all-out efforts of 10–20 minutes. ' : 'The fit is uncertain. ') +
          'A reliable estimate needs close-to-maximal efforts of roughly 3, 5, 10 and 20 minutes in the period; easy running makes the curve (and critical speed) look slower than you are.') : null,
        h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
          h('button', { class: 'primary', onclick: async (e) => {
            await postJson('settings', { thresholdSpeed: cs.cs });
            clearCache();
            e.target.replaceWith(h('span', { class: 'sub' }, `Threshold pace set to ${fmtDur(pace)} /km — pace zones now use it.`));
          } }, `Use ${fmtDur(pace)} /km as threshold pace${shaky ? ' anyway' : ''}`),
          h('span', { class: 'muted' }, 'Pace zones are fractions of the threshold (Settings).'))));
    } else {
      csBox.replaceChildren(isPace ? h('div', { class: 'card muted', style: 'margin-bottom:16px' }, 'Not enough 3–20 min efforts in this period to estimate critical speed.') : '');
    }

    // table
    const byDur = new Map(rb.map((r) => [r.duration, r]));
    const rows = ra.map((r) => {
      const b = byDur.get(r.duration);
      return { ...r, a: y(r.value), b: b ? y(b.value) : null, diff: b ? y(r.value) - y(b.value) : null };
    });
    tableBox.replaceChildren(dataTable(rows, [
      { key: 'duration', label: 'Duration', fmt: fmtSecs, defaultAsc: true },
      { key: 'a', label: isPace ? 'Best pace' : 'Best power', fmt: fmtY },
      { key: 'start_local', label: 'Date', left: true, fmt: (v) => fmtDate(v) },
      { key: 'name', label: 'Activity', left: true, cls: 'name', link: (r) => `#/activity/${r.id}` },
      B ? { key: 'b', label: 'Compared', fmt: (v) => (v == null ? '–' : fmtY(v)) } : null,
      B ? { key: 'diff', label: 'Δ', fmt: (v) => (v == null ? '–' : isPace ? `${v < 0 ? '−' : '+'}${fmtDur(Math.abs(v))}` : `${v > 0 ? '+' : ''}${Math.round(v)} W`) } : null,
    ].filter(Boolean), { sortKey: 'duration', sortDesc: false, pageSize: 50 }));
  }
  chart.on('click', (p) => { if (p.data && p.data.id) location.hash = `#/activity/${p.data.id}`; });

  drawControls();
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Best efforts'), tabs),
    controls, csBox,
    h('div', { class: 'card', style: 'margin-bottom:16px' }, chartEl, info),
    h('div', { class: 'card' }, tableBox));
  await load();
  return () => chart.dispose();
}
