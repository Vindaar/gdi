// Health: daily wellness metrics as small multiples (one measure per chart,
// shared time axis), plus an intraday view for a selected day.
import {
  api, objects, h, fmtDur, fmtNum, remember, echart, chartTheme, baseAxis, baseTooltip,
  series, segmented, tile, css, blueRamp,
} from './util.js';
import { withHrv, baselines, normalCard, unusualSignals, rollingBaseline, fmtClock } from './baselines.js';

const READINESS_FACTORS = [['readiness_sleep', 'Sleep score'], ['readiness_recovery', 'Recovery time'],
  ['readiness_hrv', 'HRV status'], ['readiness_acwr', 'Acute load'], ['readiness_stress', 'Stress history'],
  ['readiness_sleep_history', 'Sleep history']];

const state = remember('health', { range: '365', smooth: true });

function rolling(vals, w) {
  return vals.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) if (vals[j] != null) { s += vals[j]; n++; }
    return n ? s / n : null;
  });
}

export async function healthPage(app) {
  const all = objects(await api('health'));
  const GM = await api('garmin-metrics?names=hrv_night,hrv_weekly,hrv_baseline_low,hrv_baseline_high,readiness,readiness_sleep,readiness_recovery,readiness_hrv,readiness_acwr,readiness_stress,readiness_sleep_history').catch(() => ({}));
  // personal baselines over the full history (each day vs its preceding 30 days)
  const rowsAll = withHrv(all, GM);
  const base = baselines(rowsAll);
  const unusual = unusualSignals(rowsAll, base);
  const idxOf = new Map(rowsAll.map((r, i) => [r.date, i]));
  const bandCache = new Map();
  const bandFor = (key) => {
    if (!bandCache.has(key)) bandCache.set(key, rollingBaseline(rowsAll.map((r) => r[key])));
    return bandCache.get(key);
  };
  const normalBox = h('div', { class: 'card', style: 'margin-bottom:16px' });
  const charts = [];
  const grid = h('div', { class: 'grid cols-2' });
  const tilesEl = h('div', { class: 'tiles', style: 'margin-bottom:16px' });
  const dayBox = h('div', { class: 'card', style: 'margin-top:16px' });
  const controls = h('div', { class: 'filters' });

  const METRICS = [
    { key: 'resting_hr', label: 'Resting heart rate', unit: 'bpm' },
    { key: 'sleep_hours', label: 'Sleep', unit: 'h', stack: true },
    { key: 'sleep_score', label: 'Sleep score', unit: '' },
    { key: 'avg_stress', label: 'Average stress', unit: '' },
    { key: 'bb_high', label: 'Body Battery (high / low)', unit: '', band: true },
    { key: 'steps', label: 'Steps', unit: '', bar: true },
    { key: 'sleep_resp', label: 'Sleep respiration', unit: 'brpm' },
    { key: 'intensity', label: 'Intensity minutes (vigorous counts ×2)', unit: 'min', bar: true },
    { key: 'weight', label: 'Weight', unit: 'kg', sparse: true },
  ];

  function draw() {
    const s = state.get();
    charts.forEach((c) => c.dispose());
    charts.length = 0;
    grid.replaceChildren();
    const th = chartTheme();
    const fromIso = s.range === 'all' ? '0000' : new Date(Date.now() - +s.range * 86400e3).toISOString().slice(0, 10);
    const rows = all.filter((r) => r.date >= fromIso);
    const dates = rows.map((r) => r.date);
    const col = (k) => rows.map((r) => r[k] ?? null);
    const last = (k) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null) return rows[i][k]; return null; };
    const avg = (k) => { const v = col(k).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    tilesEl.replaceChildren(
      tile('Resting HR (avg)', fmtNum(avg('resting_hr'), 1), 'bpm'),
      tile('Sleep (avg)', fmtDur(avg('sleep_secs'))),
      tile('Sleep score (avg)', fmtNum(avg('sleep_score'))),
      tile('Stress (avg)', fmtNum(avg('avg_stress'))),
      tile('Steps / day', fmtNum(avg('steps'))),
      tile('Weight (latest)', fmtNum(last('weight'), 1), 'kg'));

    for (const m of METRICS) {
      const el = h('div', { class: 'chart', style: 'height:220px' });
      grid.append(h('div', { class: 'card' }, h('h2', {}, m.label + (m.unit ? ` (${m.unit})` : '')), el));
      const c = echart(el);
      charts.push(c);
      const base = {
        animation: false, grid: { left: 48, right: 12, top: 24, bottom: 28 },
        tooltip: { ...baseTooltip(th), trigger: 'axis' },
        xAxis: { type: 'category', data: dates, ...baseAxis(th), splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...baseAxis(th) },
        dataZoom: [{ type: 'inside' }],
      };
      let ser;
      if (m.stack) {
        const stages = [['deep_secs', 'Deep'], ['rem_secs', 'REM'], ['light_secs', 'Light'], ['awake_secs', 'Awake']];
        const ramp = blueRamp();   // sleep stages: own blues, independent of user palettes
        base.legend = { top: 0, textStyle: { color: th.ink2 }, itemWidth: 10, itemHeight: 10 };
        base.grid.top = 30;
        base.tooltip.valueFormatter = (v) => (v == null ? '–' : fmtDur(v * 3600));
        ser = stages.map(([k, n], i) => ({ name: n, type: 'bar', stack: 'sleep', barCategoryGap: '10%',
          itemStyle: { color: [ramp[6], ramp[4], ramp[2], css('--axis')][i] },
          data: col(k).map((v) => (v == null ? null : v / 3600)) }));
      } else if (m.band) {
        base.legend = { top: 0, textStyle: { color: th.ink2 } };
        ser = [
          { name: 'High', type: 'line', symbol: 'none', data: col('bb_high'), lineStyle: { width: 1.5, color: series(0) }, itemStyle: { color: series(0) } },
          { name: 'Low', type: 'line', symbol: 'none', data: col('bb_low'), lineStyle: { width: 1.5, color: series(1) }, itemStyle: { color: series(1) } },
        ];
      } else if (m.key === 'intensity') {
        ser = [{ name: 'Intensity min', type: 'bar', data: rows.map((r) => (r.intensity_mod ?? 0) + 2 * (r.intensity_vig ?? 0)), itemStyle: { color: series(0) } }];
      } else if (m.bar) {
        ser = [{ name: m.label, type: 'bar', data: col(m.key), itemStyle: { color: series(0) } }];
      } else {
        const vals = m.key === 'sleep_hours' ? col('sleep_secs') : col(m.key);
        ser = [];
        if (!m.sparse) {
          // personal normal: 10th–90th percentile of the preceding 30 days
          const band = bandFor(m.key);
          const bi = rows.map((r) => band[idxOf.get(r.date)]);
          ser.push({ name: 'usual-lo', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, data: bi.map((b) => b?.lo ?? null), tooltip: { show: false } },
            { name: 'Your normal (30 d)', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: th.grid, opacity: 0.9 },
              itemStyle: { color: th.grid }, data: bi.map((b) => (b ? b.hi - b.lo : null)), tooltip: { show: false } });
          base.legend = { top: 0, textStyle: { color: th.ink2, fontSize: 11 }, data: ['Your normal (30 d)'] };
          base.grid = { ...base.grid, top: 28 };
        }
        ser.push({ name: m.label, type: 'line', symbol: m.sparse ? 'circle' : 'none', symbolSize: 5, connectNulls: !!m.sparse,
          data: vals, lineStyle: { width: s.smooth && !m.sparse ? 1 : 1.5, color: s.smooth && !m.sparse ? css('--axis') : series(0) }, itemStyle: { color: series(0) } });
        if (s.smooth && !m.sparse) {
          ser.push({ name: '7-day average', type: 'line', symbol: 'none', data: rolling(vals, 7), lineStyle: { width: 2, color: series(0) }, itemStyle: { color: series(0) } });
        }
        base.tooltip.valueFormatter = (v) => (v == null ? '–' : (+v).toFixed(1));
      }
      c.setOption({ ...base, series: ser });
      // click anywhere in the plot → the day under the hover crosshair
      let hoverIdx = null;
      c.on('updateAxisPointer', (ev) => { const ax = ev.axesInfo?.[0]; hoverIdx = ax ? ax.value : null; });
      c.getZr().on('click', () => { if (hoverIdx != null && dates[hoverIdx]) showDay(dates[hoverIdx]); });
      el.style.cursor = 'pointer';
    }
    // Garmin HRV status + training readiness (garmin sync-metrics); same day axis
    const gm = (name) => new Map((GM[name] || []).map((r) => [r[0], r]));
    const hn = gm('hrv_night'), hw = gm('hrv_weekly'), lo = gm('hrv_baseline_low'), hi = gm('hrv_baseline_high'), rd = gm('readiness');
    const rf = Object.fromEntries(READINESS_FACTORS.map(([k]) => [k, gm(k)]));
    const v = (m, d) => m.get(d)?.[1] ?? null;
    const extra = [];
    if (dates.some((d) => hn.has(d))) extra.push(['Overnight HRV (ms) — Garmin baseline band', {
      legend: { top: 0, textStyle: { color: th.ink2, fontSize: 11 }, data: ['Baseline (balanced)', 'Night', '7-day average'] }, grid: { left: 48, right: 12, top: 30, bottom: 28 },
      tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => {
        const d = dates[ps[0].dataIndex];
        return `<b>${d}</b><br>night ${v(hn, d) ?? '–'} ms · 7-day ${v(hw, d) ?? '–'} ms<br>baseline ${v(lo, d) ?? '–'}–${v(hi, d) ?? '–'} · ${(hw.get(d)?.[2] || '').toLowerCase()}`;
      } },
      series: [
        // baseline band as stacked area (low, then high − low)
        { name: 'baseline', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, data: dates.map((d) => v(lo, d)), tooltip: { show: false } },
        { name: 'Baseline (balanced)', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: th.grid, opacity: 0.9 },
          itemStyle: { color: th.grid }, data: dates.map((d) => (v(hi, d) != null && v(lo, d) != null ? v(hi, d) - v(lo, d) : null)) },
        { name: 'Night', type: 'line', symbol: 'none', connectNulls: false, lineStyle: { width: 1, color: css('--axis') }, itemStyle: { color: css('--axis') }, data: dates.map((d) => v(hn, d)) },
        { name: '7-day average', type: 'line', symbol: 'none', connectNulls: true, lineStyle: { width: 2, color: series(0) }, itemStyle: { color: series(0) }, data: dates.map((d) => v(hw, d)) },
      ] }]);
    if (dates.some((d) => rd.has(d))) extra.push(['Training readiness (Garmin)', {
      grid: { left: 48, right: 12, top: 24, bottom: 28 },
      tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => {
        const d = dates[ps[0].dataIndex];
        // factor scores (0–100 %, higher = helping readiness), weakest first
        const fs = READINESS_FACTORS.map(([k, label]) => [label, v(rf[k], d)]).filter((f) => f[1] != null).sort((a, b) => a[1] - b[1]);
        return `<b>${d}</b><br>${v(rd, d) ?? '–'} · ${(rd.get(d)?.[2] || '').toLowerCase()}` +
          (fs.length ? '<br><span style="opacity:.75">factors (weakest first)</span><br>' + fs.map(([l, x]) => `${l}: ${Math.round(x)} %`).join('<br>') : '');
      } },
      yAxis: { type: 'value', min: 0, max: 100, ...baseAxis(th) },
      series: [{ name: 'Readiness', type: 'bar', data: dates.map((d) => v(rd, d)), itemStyle: { color: series(0) } }] }]);
    // nights with several recovery signals outside the normal range
    const un = rows.map((r) => unusual[idxOf.get(r.date)] || []);
    if (un.some((u) => u.length)) extra.push(['Unusual nights: recovery signals clearly outside your normal (red = 2 or more)', {
      grid: { left: 48, right: 12, top: 24, bottom: 28 },
      tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => { const i = ps[0].dataIndex; return `<b>${dates[i]}</b><br>${un[i].length ? un[i].join('<br>') : 'all within normal'}`; } },
      yAxis: { type: 'value', min: 0, max: 4, interval: 1, ...baseAxis(th) },
      series: [{ type: 'bar', data: un.map((u) => (u.length ? { value: u.length, itemStyle: { color: u.length >= 2 ? css('--critical') : series(0) } } : 0)) }] }]);
    // sleep timing
    if (rows.some((r) => r.bed_time != null)) {
      const sd = (vals) => { const v = vals.filter((x) => x != null); if (v.length < 5) return null; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
      const last14 = rows.slice(-14);
      const sb = sd(last14.map((r) => r.bed_time)), sw = sd(last14.map((r) => r.wake_time));
      extra.push([`Sleep timing — last 14 nights: bedtime ±${sb != null ? Math.round(sb * 60) : '–'} min, wake ±${sw != null ? Math.round(sw * 60) : '–'} min`, {
        legend: { top: 0, textStyle: { color: th.ink2, fontSize: 11 } }, grid: { left: 52, right: 12, top: 30, bottom: 28 },
        tooltip: { ...baseTooltip(th), trigger: 'axis', formatter: (ps) => `<b>${dates[ps[0].dataIndex]}</b><br>` + ps.map((p) => `${p.seriesName}: ${fmtClock(p.value)}`).join('<br>') },
        yAxis: { type: 'value', scale: true, inverse: true, ...baseAxis(th), axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => fmtClock(v) } },
        series: [
          { name: 'Asleep', type: 'scatter', symbolSize: 4, data: rows.map((r) => r.bed_time), itemStyle: { color: series(0) } },
          { name: 'Awake', type: 'scatter', symbolSize: 4, data: rows.map((r) => (r.wake_time == null ? null : r.wake_time + 24)), itemStyle: { color: series(1) } },
          { name: 'Asleep (7-day)', type: 'line', symbol: 'none', data: rolling(rows.map((r) => r.bed_time), 7), lineStyle: { width: 2, color: series(0) }, itemStyle: { color: series(0) } },
          { name: 'Awake (7-day)', type: 'line', symbol: 'none', data: rolling(rows.map((r) => (r.wake_time == null ? null : r.wake_time + 24)), 7), lineStyle: { width: 2, color: series(1) }, itemStyle: { color: series(1) } },
        ] }]);
    }
    for (const [title, opt] of extra.reverse()) {
      const el = h('div', { class: 'chart', style: 'height:220px' });
      grid.prepend(h('div', { class: 'card' }, h('h2', {}, title), el));
      const c = echart(el);
      charts.push(c);
      c.setOption({ animation: false, xAxis: { type: 'category', data: dates, ...baseAxis(th), splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...baseAxis(th) }, dataZoom: [{ type: 'inside' }], ...opt });
    }
  }

  let dayChart = null;
  async function showDay(date, scroll = true) {
    const j = await api(`health/${date}`);
    if (!j) return;
    dayChart?.dispose();
    const el = h('div', { class: 'chart tall' });
    const sl = j.sleep?.dailySleepDTO || {};
    const ni = idxOf.get(date);
    if (ni != null) normalBox.replaceChildren(h('h2', {}, `${date}: compared with your normal`), normalCard(rowsAll, base, ni));
    const days = all.map((r) => r.date);
    const i = days.indexOf(date);
    const picker = h('input', { type: 'date', value: date, min: days[0], max: days[days.length - 1] });
    picker.addEventListener('change', () => {
      // snap to the nearest day we have data for
      const want = picker.value;
      const next = days.find((d) => d >= want) ?? days[days.length - 1];
      showDay(next, false);
    });
    const nav = h('div', { class: 'filters', style: 'margin-bottom:12px' },
      h('h2', { style: 'margin:0' }, 'Day detail'),
      h('button', { onclick: () => i > 0 && showDay(days[i - 1], false), disabled: i <= 0, title: 'previous day' }, '‹'),
      picker,
      h('button', { onclick: () => i < days.length - 1 && showDay(days[i + 1], false), disabled: i >= days.length - 1, title: 'next day' }, '›'),
      h('span', { class: 'muted' }, new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })),
      h('span', { class: 'muted' }, '· or click a day in any chart above'));
    dayBox.replaceChildren(nav,
      h('div', { class: 'tiles', style: 'margin-bottom:12px' },
        tile('Sleep', fmtDur(sl.sleepTimeSeconds)), tile('Sleep score', fmtNum(sl.sleepScores?.overall?.value)),
        tile('Resting HR', fmtNum(j.summary?.restingHeartRate), 'bpm'), tile('Steps', fmtNum(j.summary?.totalSteps)),
        tile('Stress avg', fmtNum(j.summary?.averageStressLevel)), tile('Body Battery', `${fmtNum(j.summary?.bodyBatteryLowestValue)}–${fmtNum(j.summary?.bodyBatteryHighestValue)}`)),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Heart rate, stress and Body Battery through the day (one panel each).'), el);
    dayChart = echart(el);
    const th = chartTheme();
    const hr = (j.heartRate?.heartRateValues || []).filter((p) => p[1] != null).map((p) => [p[0], p[1]]);
    const stress = (j.stress?.stressValuesArray || []).filter((p) => p[1] >= 0).map((p) => [p[0], p[1]]);
    const bbArr = j.stress?.bodyBatteryValuesArray || [];
    const bb = bbArr.filter((p) => p[2] != null).map((p) => [p[0], p[2]]);
    const axes = [0, 1, 2];
    dayChart.setOption({
      animation: false,
      tooltip: { ...baseTooltip(th), trigger: 'axis' },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: axes.map((i) => ({ left: 48, right: 12, top: 10 + i * 33 + '%', height: '24%' })),
      xAxis: axes.map((i) => ({ type: 'time', gridIndex: i, ...baseAxis(th), splitLine: { show: false }, axisLabel: { ...baseAxis(th).axisLabel, show: i === 2 } })),
      yAxis: axes.map((i) => ({ type: 'value', gridIndex: i, scale: i === 0, name: ['HR', 'Stress', 'Body Battery'][i], ...baseAxis(th) })),
      series: [
        { name: 'HR', type: 'line', symbol: 'none', xAxisIndex: 0, yAxisIndex: 0, data: hr, lineStyle: { width: 1.5, color: series(0) }, itemStyle: { color: series(0) } },
        { name: 'Stress', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: stress, itemStyle: { color: series(1) }, barWidth: 1 },
        { name: 'Body Battery', type: 'line', symbol: 'none', xAxisIndex: 2, yAxisIndex: 2, data: bb, lineStyle: { width: 2, color: series(2) }, itemStyle: { color: series(2) }, areaStyle: { opacity: 0.12 } },
      ],
    });
    if (scroll) dayBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const s = state.get();
  controls.replaceChildren(
    h('label', {}, 'Range', segmented([['30', '1 mo'], ['90', '3 mo'], ['365', '1 y'], ['730', '2 y'], ['all', 'All']], s.range, (v) => { state.set({ range: v }); draw(); })),
    h('label', {}, 'Daily values', segmented([[true, '+ 7-day average'], [false, 'raw only']], s.smooth, (v) => { state.set({ smooth: v }); draw(); })),
    h('span', { class: 'muted' }, 'Click any day to see its intraday detail.'));
  app.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Health')), controls, tilesEl, normalBox, grid, dayBox);
  draw();
  if (all.length) showDay(all[all.length - 1].date, false).catch(() => {});
  return () => { charts.forEach((c) => c.dispose()); dayChart?.dispose(); };
}
