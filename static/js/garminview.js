// "Garmin's assessment": Garmin's server-side metrics (garmin sync-metrics),
// shown as small multiples next to our own measures — never on a shared axis.
import { api, objects, h, fmtDur, chartTheme, baseAxis, baseTooltip, series, css, fmtDate } from './util.js';

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const STATUS_ORDER = ['DETRAINING', 'RECOVERY', 'MAINTAINING', 'PRODUCTIVE', 'PEAKING', 'OVERREACHING', 'UNPRODUCTIVE', 'STRAINED'];
const statusOf = (text) => (text || '').replace(/_\d+$/, '').replace(/_.*$/, '');

/** Season-best progression: best time in the preceding `days` for each effort date. */
function rollingBest(rows, days = 90) {
  const pts = rows.map((r) => [Date.parse(r.start_local), r.time]).sort((a, b) => a[0] - b[0]);
  return pts.map(([t], i) => {
    let best = Infinity;
    for (let k = i; k >= 0 && pts[k][0] >= t - days * 86400e3; k--) best = Math.min(best, pts[k][1]);
    return [t, best];
  });
}

export function createGarminCard(mk) {
  const panels = [
    ['vo2', 'VO₂max (running)', 'Garmin estimate from qualifying runs.'],
    ['race', 'Race predictions vs your 90-day bests', 'Lines: Garmin predictions (as pace). Dots: your best 5 km / 10 km within the preceding 90 days.'],
    ['endurance', 'Endurance score', 'Garmin: ability to sustain effort, from all endurance activities.'],
    ['hill', 'Hill score (overall · strength · endurance)', 'Garmin: uphill running ability.'],
    ['lt', 'Lactate-threshold pace (Garmin)', 'Steps at each automatic detection. Your pace-zone threshold is a separate setting.'],
    ['status', 'Training status', 'Garmin\'s daily status (from load, VO₂max trend and HRV).'],
    ['load', 'Acute vs chronic load', 'Garmin: 7-day acute load vs 4-week chronic load (EPOC-based). Tooltip: ratio and Garmin\'s rating.'],
    ['fitage', 'Fitness age', 'Garmin: from VO₂max, resting HR, BMI and vigorous minutes. "Achievable" assumes Garmin\'s targets are met.'],
    ['heat', 'Heat acclimation', 'Garmin: % acclimated, from activity in heat; decays over days without heat exposure.'],
    ['alt', 'Altitude acclimation', 'Garmin: altitude (m) you are acclimated to, from time spent at altitude; decays back to 0.'],
  ];
  const charts = {}, els = {};
  for (const [k] of panels) [els[k], charts[k]] = mk();
  const el = h('div', { class: 'card', style: 'margin-top:16px' },
    h('h2', {}, 'Garmin\'s assessment'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      'Garmin\'s own computed metrics (synced with garmin sync-metrics), for comparison with the measures above. Model outputs, not measurements.'),
    h('div', { class: 'grid cols-2' }, panels.map(([k, title, note]) =>
      h('div', {}, h('h3', {}, title), h('div', { class: 'muted', style: 'font-size:12px' }, note), els[k]))));

  async function draw(fromIso) {
    const th = chartTheme();
    const M = await api('garmin-metrics').catch(() => ({}));
    const pick = (name, f = (v) => v) => (M[name] || []).filter((r) => r[0] >= fromIso && r[1] != null).map((r) => [Date.parse(r[0]), f(r[1]), r[2]]);
    const timeAxis = { type: 'time', ...baseAxis(th), splitLine: { show: false } };
    const base = (extra = {}) => ({
      animation: false, grid: { left: 52, right: 12, top: 28, bottom: 32 }, dataZoom: [{ type: 'inside' }],
      tooltip: { ...baseTooltip(th), trigger: 'axis' }, xAxis: timeAxis, ...extra,
    });
    const line = (name, data, i, extra = {}, n) => ({ name, type: 'line', symbol: 'none', data, connectNulls: true,
      lineStyle: { width: 2, color: series(i, n) }, itemStyle: { color: series(i, n) }, ...extra });
    const paceAxis = { type: 'value', inverse: true, scale: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => fmtDur(v) } };
    const empty = (c, text = 'no data in range') => c.setOption({ title: { text, left: 'center', top: 'middle', textStyle: { color: th.muted, fontSize: 12, fontWeight: 'normal' } } }, true);

    // VO2max
    const vo2 = pick('vo2max');
    vo2.length ? charts.vo2.setOption(base({ yAxis: { type: 'value', scale: true, ...baseAxis(th) },
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => (+v).toFixed(1) },
      series: [line('VO₂max', vo2, 0, { step: 'end' })] }), true) : empty(charts.vo2);

    // race predictions (pace) + actual rolling bests
    const dist = { race_5k: 5000, race_10k: 10000, race_half: 21097.5, race_marathon: 42195 };
    const names = { race_5k: '5 km', race_10k: '10 km', race_half: 'Half', race_marathon: 'Marathon' };
    const raceSeries = Object.keys(dist).map((k, i) => line(`${names[k]} (Garmin)`, pick(k, (v) => v / (dist[k] / 1000)), i, {}, 4));
    try {
      const [e5, e10] = await Promise.all([api('efforts?distance=5000&family=running'), api('efforts?distance=10000&family=running')]);
      for (const [rows, i, label, d] of [[objects(e5), 0, '5 km best (90 d)', 5], [objects(e10), 1, '10 km best (90 d)', 10]]) {
        const pts = rollingBest(rows).filter((p) => isoDay(p[0]) >= fromIso).map((p) => [p[0], p[1] / d]);
        raceSeries.push({ name: label, type: 'scatter', symbolSize: 5, data: pts, itemStyle: { color: series(i, 4), opacity: 0.6 } });
      }
    } catch {}
    raceSeries.some((s) => s.data.length) ? charts.race.setOption(base({
      legend: { top: 0, type: 'scroll', textStyle: { color: th.ink2, fontSize: 11 } }, grid: { left: 52, right: 12, top: 40, bottom: 32 },
      yAxis: paceAxis, tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => (v == null ? '–' : `${fmtDur(v)} /km`) },
      series: raceSeries }), true) : empty(charts.race);

    // endurance score
    const end = pick('endurance_score');
    end.length ? charts.endurance.setOption(base({ yAxis: { type: 'value', scale: true, ...baseAxis(th) }, series: [line('Endurance score', end, 0)] }), true) : empty(charts.endurance);

    // hill score
    const hill = [pick('hill_score'), pick('hill_strength'), pick('hill_endurance')];
    hill[0].length ? charts.hill.setOption(base({ legend: { top: 0, textStyle: { color: th.ink2, fontSize: 11 } },
      yAxis: { type: 'value', scale: true, ...baseAxis(th) },
      series: [line('Overall', hill[0], 0), line('Strength', hill[1], 1), line('Endurance', hill[2], 2)] }), true) : empty(charts.hill);

    // lactate threshold pace (steps)
    const lt = pick('lt_speed', (v) => 1000 / v);
    lt.length ? charts.lt.setOption(base({ yAxis: paceAxis, tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => `${fmtDur(v)} /km` },
      series: [line('LT pace', lt.map((p) => [p[0], p[1]]).concat(lt.length ? [[Date.now(), lt[lt.length - 1][1]]] : []), 0, { step: 'end', symbol: 'circle', symbolSize: 5 })] }), true) : empty(charts.lt);

    // acute vs chronic load (same unit) — ratio only in the tooltip
    const acute = pick('acute_load'), chronic = pick('chronic_load');
    const acwr = new Map(pick('acwr').map((p) => [p[0], p]));
    acute.length ? charts.load.setOption(base({ legend: { top: 0, textStyle: { color: th.ink2, fontSize: 11 } },
      yAxis: { type: 'value', ...baseAxis(th) },
      tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => {
        const t = ps[0].data[0], r = acwr.get(t);
        return `<b>${fmtDate(isoDay(t))}</b><br>` + ps.map((p) => `${p.seriesName}: ${Math.round(p.data[1])}`).join('<br>') +
          (r ? `<br>ratio ${r[1].toFixed(1)} · ${(r[2] || '').toLowerCase()}` : '');
      } },
      series: [line('Acute (7 d)', acute, 0, {}, 2), line('Chronic (28 d)', chronic, 1, {}, 2)] }), true) : empty(charts.load);

    // fitness age
    const fa = pick('fitness_age'), faA = pick('fitness_age_achievable');
    fa.length ? charts.fitage.setOption(base({ legend: { top: 0, textStyle: { color: th.ink2, fontSize: 11 } },
      yAxis: { type: 'value', scale: true, ...baseAxis(th) },
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => (v == null ? '–' : `${(+v).toFixed(1)} y`) },
      series: [line('Fitness age', fa, 0, {}, 2), line('Achievable', faA, 1, { step: 'end', lineStyle: { width: 1, type: 'dashed', color: series(1, 2) } }, 2)] }), true) : empty(charts.fitage);

    // heat / altitude acclimation (separate panels: % vs metres)
    const heat = pick('heat_acclimation');
    heat.some((p) => p[1] > 0) ? charts.heat.setOption(base({ yAxis: { type: 'value', min: 0, max: 100, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: '{value} %' } },
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => `${Math.round(v)} %` },
      series: [line('Heat acclimation', heat, 3, { areaStyle: { color: series(3), opacity: 0.15 } })] }), true)
      : empty(charts.heat, heat.length ? 'no heat acclimation in range (0 %)' : 'no data in range');
    const alt = pick('altitude_acclimation');
    alt.some((p) => p[1] > 0) ? charts.alt.setOption(base({ yAxis: { type: 'value', min: 0, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: '{value} m' } },
      tooltip: { ...baseTooltip(th), trigger: 'axis', valueFormatter: (v) => `${Math.round(v)} m` },
      series: [line('Altitude acclimation', alt, 2, { step: 'end', areaStyle: { color: series(2), opacity: 0.15 } })] }), true)
      : empty(charts.alt, alt.length ? 'no altitude exposure in range (0 m)' : 'no data in range');

    // training status (categorical timeline)
    const st = pick('training_status').map((p) => [p[0], statusOf(p[2])]).filter((p) => p[1]);
    const cats = STATUS_ORDER.filter((s) => st.some((p) => p[1] === s)).concat([...new Set(st.map((p) => p[1]))].filter((s) => !STATUS_ORDER.includes(s)));
    st.length ? charts.status.setOption(base({ grid: { left: 110, right: 12, top: 16, bottom: 32 },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => `${fmtDate(isoDay(p.data[0]))}: ${p.data[1].toLowerCase()}` },
      yAxis: { type: 'category', data: cats, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => v.toLowerCase() } },
      series: [{ type: 'scatter', symbol: 'rect', symbolSize: [4, 12], data: st, itemStyle: { color: series(0) } }] }), true) : empty(charts.status);
  }
  return { el, charts: Object.values(charts), draw };
}
