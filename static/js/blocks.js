// Training blocks: two date ranges side by side — volume, intensity mix,
// efficiency, bests inside the block, and health over the same days.
// A = the earlier/reference block, B = the one being judged; Δ = B − A.
import {
  api, h, fmtDur, fmtNum, fmtPace, fmtSpeedFor, speedUnit, usesPace, FAMILIES, remember,
  segmented, echart, chartTheme, baseAxis, baseTooltip, series, zoneColor, settingsZones,
} from './util.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };

/** Presets → [aFrom, aTo, bFrom, bTo]; B always ends today. */
const PRESETS = {
  '4w': ['4 wk vs previous 4', (t) => [addDays(t, -55), addDays(t, -28), addDays(t, -27), t]],
  '12w': ['12 wk vs previous 12', (t) => [addDays(t, -167), addDays(t, -84), addDays(t, -83), t]],
  'yoy12': ['Last 12 wk vs a year earlier', (t) => [addYears(addDays(t, -83), -1), addYears(t, -1), addDays(t, -83), t]],
  'ytd': ['Year to date vs last year', (t) => [new Date(t.getFullYear() - 1, 0, 1), addYears(t, -1), new Date(t.getFullYear(), 0, 1), t]],
};

const state = remember('blocks', { family: 'running', preset: '12w', aFrom: '', aTo: '', bFrom: '', bTo: '', weekly: 'distance' });

export async function blocksPage(app) {
  const s = state.get();
  const settings = await api('settings');
  const Z = settingsZones(settings);
  if (!s.aFrom) applyPreset(s.preset);

  const famSel = h('select', {}, FAMILIES.slice(0, 4).map((f) => h('option', { value: f, selected: s.family === f }, f)));
  const dateIn = (k) => h('input', { type: 'date', value: state.get()[k] });
  const inputs = { aFrom: dateIn('aFrom'), aTo: dateIn('aTo'), bFrom: dateIn('bFrom'), bTo: dateIn('bTo') };
  const presetBox = h('span', {});
  const tableBox = h('div', {});
  const zonesBox = h('div', {});
  const weeklyHead = h('div', { class: 'page-head', style: 'margin:0 0 4px' });
  const chartEl = h('div', { class: 'chart' });
  const chart = echart(chartEl);

  function applyPreset(key) {
    const [a0, a1, b0, b1] = PRESETS[key][1](new Date()).map(iso);
    state.set({ preset: key, aFrom: a0, aTo: a1, bFrom: b0, bTo: b1 });
  }
  function drawPresets() {
    presetBox.replaceChildren(segmented(Object.entries(PRESETS).map(([k, [label]]) => [k, label]), state.get().preset, (k) => {
      applyPreset(k);
      for (const [key, el] of Object.entries(inputs)) el.value = state.get()[key];
      load();
    }));
  }

  let A = null, B = null;
  async function load() {
    const st = state.get();
    tableBox.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    [A, B] = await Promise.all([
      api(`block?family=${st.family}&from=${st.aFrom}&to=${st.aTo}`),
      api(`block?family=${st.family}&from=${st.bFrom}&to=${st.bTo}`),
    ]);
    render();
  }

  function render() {
    const fam = state.get().family;
    const weeksOf = (X) => Math.max(1, (Date.parse(X.to) - Date.parse(X.from)) / 864e5 + 1) / 7;
    const wA = weeksOf(A), wB = weeksOf(B);
    const pace = usesPace(fam);
    // row: {label, a, b, fmt(v, X), d(a, b) → delta text, better: +1 higher is better, −1 lower, 0 neutral, note?, ids?}
    const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±');
    const pct = (a, b) => (a ? `${sign(b - a)}${fmtNum(Math.abs(100 * (b - a) / a))} %` : '–');
    const diff = (unit, dg = 0) => (a, b) => `${sign(b - a)}${fmtNum(Math.abs(b - a), dg)}${unit}`;
    const tdiff = (a, b) => `${sign(b - a)}${fmtDur(Math.abs(b - a))}`;
    const paceDiff = (a, b) => diff(' s/km')(1000 / a, 1000 / b);              // speeds → s/km
    const speedDiff = pace ? paceDiff : (a, b) => diff(' km/h', 1)(a * 3.6, b * 3.6);
    const perWk = (X, w, k) => (X.volume[k] == null ? null : X.volume[k] / w);
    const speedFmt = (v) => (v == null ? '–' : `${fmtSpeedFor(fam, v)} ${speedUnit(fam)}`);
    const or = (f) => (v, X) => (v == null ? '–' : f(v, X));
    const R = (label, a, b, fmt, d, better, extra = {}) => ({ label, a, b, fmt: or(fmt), d, better, ...extra });
    const best = (X, k) => X.bests[k]?.[0] ?? null;
    const mm = (X, k) => X.mmp[k]?.[0] ?? null;
    const E = (k) => [A.efficiency[k], B.efficiency[k]];
    const H = (k) => [A.health[k], B.health[k]];
    const sections = [
      ['Volume (per week)', [
        R('Activities', A.volume.n / wA, B.volume.n / wB, (v) => fmtNum(v, 1), pct, 0),
        R('Distance', perWk(A, wA, 'distance'), perWk(B, wB, 'distance'), (v) => `${fmtNum(v / 1000, 1)} km`, pct, 0),
        R('Moving time', perWk(A, wA, 'moving'), perWk(B, wB, 'moving'), fmtDur, pct, 0),
        R('Ascent', perWk(A, wA, 'ascent'), perWk(B, wB, 'ascent'), (v) => `${fmtNum(v)} m`, pct, 0),
        R('Training load', perWk(A, wA, 'load'), perWk(B, wB, 'load'), (v) => fmtNum(v), pct, 0),
        R('Longest activity', A.volume.longest, B.volume.longest, (v) => `${fmtNum(v / 1000, 1)} km`, (a, b) => diff(' km', 1)(a / 1000, b / 1000), 0),
      ]],
      ['Efficiency (median per activity)', [
        ...(fam === 'running' ? [
          R('vs expected pace', ...E('expDelta'), (v) => `${sign(v)}${Math.abs(Math.round(v))} s/km`, diff(' s/km'), -1,
            { note: 'actual − expected pace at the run\'s HR and terrain (− = faster than expected); see Performance' }),
          R('Pace at 140 bpm (model)', ...E('refPace'), (v) => `${fmtDur(v)} /km`, diff(' s/km'), -1,
            { note: 'expected-pace model of the block\'s runs, flat road, 30 min into the run' }),
        ] : []),
        R('Aerobic decoupling', ...E('decoupling'), (v, X) => `${fmtNum(v, 1)} % · ${X.efficiency.nSteady} steady`, diff(' pp', 1), -1,
          { note: 'steady activities only (≥ 30 min after warm-up, pace/power CV ≤ 12 %)' }),
        R('Avg HR', ...E('avgHr'), (v) => `${fmtNum(v)} bpm`, diff(' bpm'), 0),
        ...(fam === 'running' ? [R('Avg GAP', ...E('avgGap'), (v) => `${fmtPace(v)} /km`, paceDiff, 0)] : []),
      ]],
      ['Bests inside the block', [
        ...[['1000', '1 km'], ['5000', '5 km'], ['10000', '10 km'], ['21097', 'Half marathon']].map(([k, label]) =>
          R(label, best(A, k), best(B, k), fmtDur, tdiff, -1, { ids: [A.bests[k]?.[1], B.bests[k]?.[1]] })),
        ...[['60', '1 min'], ['300', '5 min'], ['1200', '20 min'], ['3600', '60 min']].map(([k, label]) =>
          R(`Best ${label} ${pace ? 'pace' : 'speed'}`, mm(A, k), mm(B, k), speedFmt, speedDiff, 1, { ids: [A.mmp[k]?.[1], B.mmp[k]?.[1]] })),
      ]],
      ['Health (daily average)', [
        R('Resting HR', ...H('restingHr'), (v) => `${fmtNum(v, 1)} bpm`, diff(' bpm', 1), -1),
        R('Overnight HRV', ...H('hrv_night'), (v) => `${fmtNum(v)} ms`, diff(' ms'), 1),
        R('Sleep', ...H('sleep'), fmtDur, tdiff, 1),
        R('Sleep score', ...H('sleepScore'), (v) => fmtNum(v), diff(''), 1),
        R('Stress', ...H('stress'), (v) => fmtNum(v), diff(''), -1),
        R('Training readiness', ...H('readiness'), (v) => fmtNum(v), diff(''), 1),
        R('VO₂max (Garmin)', ...H('vo2max'), (v) => fmtNum(v, 1), diff('', 1), 1),
        R('Steps', ...H('steps'), (v) => fmtNum(v), pct, 0),
        R('Weight', ...H('weight'), (v) => `${fmtNum(v, 1)} kg`, diff(' kg', 1), 0),
      ]],
    ];
    const deltaCell = (r) => {
      if (r.a == null || r.b == null) return h('td', { class: 'muted' }, '–');
      // direction in words, never by colour alone
      let txt = r.d(r.a, r.b);
      // a change that rounds to zero at the shown precision gets no verdict
      const zero = /^[+−±]0(?:[.:]0+)*(?![\d.:])/.test(txt);
      if (zero) txt = `±${txt.slice(1)}`;
      const verdict = r.better === 0 || zero ? '' : (Math.sign(r.b - r.a) === r.better ? 'better' : 'worse');
      return h('td', {}, txt, verdict ? h('span', { class: `delta delta-${verdict}` }, ` ${verdict}`) : null);
    };
    const link = (id, content) => (id ? h('a', { href: `#/activity/${id}` }, content) : content);
    const rows = sections.flatMap(([title, items]) => [
      h('tr', { class: 'group' }, h('th', { colspan: 4, class: 'l' }, title)),
      ...items.map((r) => h('tr', {},
        h('td', { class: 'l', title: r.note || null }, r.label, r.note ? h('span', { class: 'muted' }, ' ⓘ') : null),
        h('td', {}, link(r.ids?.[0], r.fmt(r.a, A))), h('td', {}, link(r.ids?.[1], r.fmt(r.b, B))),
        deltaCell(r))),
    ]);
    const nA = A.volume.n, nB = B.volume.n;
    tableBox.replaceChildren(h('table', { class: 'data blocks' },
      h('thead', {}, h('tr', {}, h('th', { class: 'l' }, ''),
        h('th', {}, h('div', {}, 'A'), h('div', { class: 'muted' }, `${A.from} – ${A.to}`), h('div', { class: 'muted' }, `${nA} activities`)),
        h('th', {}, h('div', {}, 'B'), h('div', { class: 'muted' }, `${B.from} – ${B.to}`), h('div', { class: 'muted' }, `${nB} activities`)),
        h('th', {}, 'B vs A'))),
      h('tbody', {}, rows)));

    // intensity mix: one stacked bar per block, same zone colours as everywhere
    const mix = (title, za, zb, names, labels) => {
      const ta = za.reduce((x, y) => x + y, 0), tb = zb.reduce((x, y) => x + y, 0);
      const bar = (z, t) => h('div', { class: 'zbar' }, z.map((v, i) => (v > 0 ? h('div', {
        style: `flex:${v};background:${zoneColor(i)}`, title: `${i ? `Z${i} ` : ''}${names[i]}: ${fmtNum(100 * v / t, 1)} %` }) : null)));
      return h('div', {},
        h('h3', {}, title),
        ta || tb ? h('div', { class: 'blockmix' },
          h('span', { class: 'muted' }, 'A'), ta ? bar(za, ta) : h('span', { class: 'muted' }, 'no data'),
          h('span', { class: 'muted' }, 'B'), tb ? bar(zb, tb) : h('span', { class: 'muted' }, 'no data')) : h('div', { class: 'muted' }, 'no data'),
        h('div', { class: 'zlist blockzl' }, h('span', {}), h('span', {}), h('span', { class: 'muted', style: 'text-align:right' }, 'A'), h('span', { class: 'muted', style: 'text-align:right' }, 'B'),
          names.flatMap((n, i) => (za[i] || zb[i] ? [
          h('span', {}, h('span', { class: 'sw', style: `background:${zoneColor(i)}` }), i ? `Z${i}` : '—'),
          h('span', { class: 'sub' }, `${n} `, h('span', { class: 'muted' }, labels[i])),
          h('span', { style: 'text-align:right' }, ta ? `${fmtNum(100 * za[i] / ta, 1)} %` : '–'),
          h('span', { style: 'text-align:right' }, tb ? `${fmtNum(100 * zb[i] / tb, 1)} %` : '–'),
        ] : []))));
    };
    zonesBox.replaceChildren(h('div', { class: 'grid cols-2' },
      mix('Heart-rate zones (moving time)', A.hrZones, B.hrZones, Z.hrNames, Z.hrLabels),
      fam === 'running' || usesPace(fam) ? mix(A.paceZonesGap ? 'Grade-adjusted pace zones' : 'Pace zones', A.paceZones, B.paceZones, Z.paceNames, Z.paceLabels) : null));

    drawWeekly();
  }

  const WEEKLY = { distance: ['Distance (km)', (v) => v / 1000, 1], moving: ['Moving time (h)', (v) => v / 3600, 1], load: ['Training load', (v) => v, 0], n: ['Activities', (v) => v, 0] };
  function drawWeekly() {
    const key = state.get().weekly;
    const [label, f, d] = WEEKLY[key];
    weeklyHead.replaceChildren(h('h2', { style: 'margin:0' }, 'Week by week'),
      segmented(Object.entries(WEEKLY).map(([k, [l]]) => [k, l]), key, (k) => { state.set({ weekly: k }); drawWeekly(); }),
      h('span', { class: 'sub' }, 'Weeks aligned from each block\'s start (Monday-based).'));
    // full week list from each block's first Monday, so empty weeks show as 0
    const weeks = (X) => {
      const m = new Map(X.weekly.rows.map((r) => [r[0], r]));
      const idx = X.weekly.cols.indexOf(key);
      const start = new Date(`${X.from}T12:00`); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const out = [];
      for (let t = start; iso(t) <= X.to; t = addDays(t, 7)) { const r = m.get(iso(t)); out.push([iso(t), r ? f(r[idx] ?? 0) : 0]); }
      return out;
    };
    const wa = weeks(A), wb = weeks(B);
    const n = Math.max(wa.length, wb.length);
    const th = chartTheme();
    chart.setOption({
      animation: false, grid: { left: 52, right: 12, top: 30, bottom: 32 },
      legend: { top: 0, textStyle: { color: th.ink2 }, data: ['A', 'B'] },
      tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => `<b>Week ${ps[0].dataIndex + 1}</b><br>` +
        ps.map((p) => { const w = (p.seriesName === 'A' ? wa : wb)[p.dataIndex]; return w ? `${p.seriesName} (${w[0]}): ${fmtNum(w[1], d)}` : ''; }).join('<br>') },
      xAxis: { type: 'category', data: Array.from({ length: n }, (_, i) => `W${i + 1}`), ...baseAxis(th) },
      yAxis: { type: 'value', name: label, nameTextStyle: { color: th.ink2 }, ...baseAxis(th) },
      series: [
        { name: 'A', type: 'bar', data: wa.map((w) => w[1]), itemStyle: { color: series(0, 2), borderRadius: [4, 4, 0, 0] }, barGap: '10%' },
        { name: 'B', type: 'bar', data: wb.map((w) => w[1]), itemStyle: { color: series(1, 2), borderRadius: [4, 4, 0, 0] } },
      ],
    }, true);
  }

  famSel.addEventListener('change', () => { state.set({ family: famSel.value }); load(); });
  for (const [k, el] of Object.entries(inputs)) {
    el.addEventListener('change', () => { if (el.value) { state.set({ [k]: el.value, preset: '' }); drawPresets(); load(); } });
  }
  drawPresets();

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Training blocks'),
      h('span', { class: 'sub' }, 'Two periods side by side. A = reference, B = the block you are judging. Duplicate uploads are left out.')),
    h('div', { class: 'filters' }, h('label', {}, 'Sport', famSel), h('label', {}, 'Preset', presetBox),
      h('label', {}, 'A from', inputs.aFrom), h('label', {}, 'A to', inputs.aTo),
      h('label', {}, 'B from', inputs.bFrom), h('label', {}, 'B to', inputs.bTo)),
    h('div', { class: 'blocks-layout' },
      h('div', { class: 'card', style: 'overflow-x:auto' }, tableBox),
      h('div', {},
        h('div', { class: 'card', style: 'margin-bottom:16px' }, weeklyHead, chartEl),
        h('div', { class: 'card' }, zonesBox))));
  await load();
  return () => chart.dispose();
}
