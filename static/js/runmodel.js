// "Faster / slower than expected" card for a run (model: src/gdi_models.nim).
import {
  api, objects, h, fmtDur, fmtNum, echart, chartTheme, baseAxis, baseTooltip, series, css,
} from './util.js';

const signed = (s) => `${s > 0 ? '+' : s < 0 ? '−' : '±'}${Math.abs(Math.round(s))}`;

/** One-line verdict, with the typical scatter as the yardstick. */
export function verdict(delta, noise) {
  const a = Math.abs(delta);
  if (a < noise * 0.5) return 'about as expected';
  const dir = delta < 0 ? 'faster' : 'slower';
  return a > noise * 1.5 ? `clearly ${dir} than expected` : `somewhat ${dir} than expected`;
}

function median(xs) {
  const v = xs.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q);
  return v.length ? v[v.length >> 1] : null;
}

/** Context facts for the run's day — shown, not modelled. */
async function contextFacts(a, model) {
  const facts = [];
  const temp = a.w_temp;
  if (temp != null && model.window_temp != null) {
    const d = temp - model.window_temp;
    facts.push(`Weather ${fmtNum(temp)} °C, ${Math.abs(d) < 3 ? 'similar to' : d > 0 ? `${fmtNum(d)} °C warmer than` : `${fmtNum(-d)} °C colder than`} the runs in the comparison window.`);
  }
  if (a.ascent_per_km != null) facts.push(`${fmtNum(a.ascent_per_km, 1)} m ascent per km${a.type_key === 'trail_running' ? ', trail' : ''} (terrain is part of the model).`);
  try {
    const health = objects(await api('health'));
    const day = a.start_local.slice(0, 10);
    const i = health.findIndex((r) => r.date === day);
    if (i >= 0) {
      const prev = health.slice(Math.max(0, i - 30), i);
      const r = health[i];
      if (r.sleep_score != null) {
        const m = median(prev.map((x) => x.sleep_score));
        facts.push(`Sleep score that night ${fmtNum(r.sleep_score)}${m != null ? ` (30-day median ${fmtNum(m)})` : ''}.`);
      }
      if (r.resting_hr != null) {
        const m = median(prev.map((x) => x.resting_hr));
        facts.push(`Resting HR ${fmtNum(r.resting_hr)} bpm${m != null ? ` (30-day median ${fmtNum(m)})` : ''}.`);
      }
    }
  } catch {}
  try {
    const acts = objects(await api('activities'));
    const runs = acts.filter((x) => x.parent_type === 'running' && x.start_local < a.start_local).sort((p, q) => (p.start_local < q.start_local ? 1 : -1));
    if (runs.length) {
      const days = (Date.parse(a.start_local) - Date.parse(runs[0].start_local)) / 86400e3;
      facts.push(`${days < 1 ? 'Less than a day' : `${fmtNum(days)} day${Math.round(days) === 1 ? '' : 's'}`} since the previous run.`);
    }
  } catch {}
  return facts;
}

export async function runModelCard(a, model, noise) {
  if (!model) return null;
  noise = +noise || 17;
  const th = chartTheme();
  const delta = model.delta;
  const chartEl = h('div', { class: 'chart', style: 'height:300px' });
  const facts = await contextFacts(a, model);
  const caveat = h('div', { class: 'sub', style: 'margin-bottom:10px', hidden: true });
  const card = h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('h2', {}, 'Compared with your recent running'),
    h('div', { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start' },
      h('div', { style: 'flex:1 1 320px;min-width:0' },
        h('div', { style: 'font-size:20px;font-weight:600;margin-bottom:4px' },
          `${signed(delta)} s/km — ${verdict(delta, noise)}`),
        h('div', { class: 'sub', style: 'margin-bottom:10px' },
          `Expected ${fmtDur(model.expected_pace)} /km (grade-adjusted) at your heart rate on this terrain; actual ${fmtDur(model.actual_pace)} /km. ` +
          `Typical run-to-run scatter: ±${Math.round(noise)} s/km.`),
        caveat,
        h('h3', {}, 'Context (shown, not modelled)'),
        h('ul', { style: 'margin:0;padding-left:18px;color:var(--ink-2)' }, facts.map((f) => h('li', {}, f))),
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:10px' },
          `Model: grade-adjusted speed from heart rate, time into the run and terrain, fitted on ${model.window_n} one-km segments ` +
          `from the previous ${Math.round(model.window_days)} days. Score = median over this run's segments (first km skipped). ` +
          `In your history, sleep score and resting HR showed no measurable relation to the score.`)),
      h('div', { style: 'flex:1 1 420px;min-width:0' }, chartEl)));
  // scatter: window segments vs this run's, with the model line (road, flat, 30 min in)
  api(`activity/${a.id}/model-window`).then((w) => {
    if (!w) return;
    const rows = objects(w);
    // is this run's HR inside the range the model was fitted on?
    const winHr = rows.filter((r) => !r.mine).map((r) => r.avg_hr).sort((p, q) => p - q);
    const myHr = median(rows.filter((r) => r.mine).map((r) => r.avg_hr));
    if (winHr.length && myHr != null) {
      const p5 = winHr[Math.floor(winHr.length * 0.05)], p95 = winHr[Math.floor(winHr.length * 0.95)];
      if (myHr > p95 || myHr < p5) {
        caveat.hidden = false;
        caveat.textContent = `⚠ This run's heart rate (median ${Math.round(myHr)} bpm) is ${myHr > p95 ? 'above' : 'below'} 95 % of the comparison data ` +
          `(${Math.round(p5)}–${Math.round(p95)} bpm), so the expected pace is an extrapolation of the model and the score is less reliable.`;
      }
    }
    const c = echart(chartEl);
    const coef = JSON.parse(model.coef);
    const hrs = rows.map((r) => r.avg_hr);
    const lo = Math.min(...hrs), hi = Math.max(...hrs);
    const line = [];
    for (let x = Math.floor(lo); x <= Math.ceil(hi); x += 2) {
      const sp = coef[0] + coef[1] * x + coef[2] * 0.5;
      if (sp > 0.8) line.push([x, 1000 / sp]);
    }
    c.setOption({
      animation: false, grid: { left: 56, right: 12, top: 28, bottom: 40 },
      legend: { top: 0, textStyle: { color: th.ink2 }, data: ['Earlier segments', 'This run', 'Model (road, flat)'] },
      tooltip: { ...baseTooltip(th), trigger: 'item', formatter: (p) => (p.seriesIndex === 2 ? `Model: ${fmtDur(p.data[1])} /km at ${p.data[0]} bpm`
        : `${fmtNum(p.data[0])} bpm · ${fmtDur(p.data[1])} /km GAP`) },
      xAxis: { type: 'value', name: 'Heart rate (bpm)', nameLocation: 'middle', nameGap: 26, scale: true, ...baseAxis(th) },
      yAxis: { type: 'value', name: 'GAP', nameLocation: 'middle', nameGap: 42, inverse: true, scale: true, ...baseAxis(th),
        axisLabel: { ...baseAxis(th).axisLabel, formatter: (v) => fmtDur(v) } },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
      series: [
        { name: 'Earlier segments', type: 'scatter', symbolSize: 5, itemStyle: { color: css('--axis'), opacity: 0.7 },
          data: rows.filter((r) => !r.mine).map((r) => [r.avg_hr, 1000 / r.avg_gap]) },
        { name: 'This run', type: 'scatter', symbolSize: 9, z: 5, itemStyle: { color: series(1, 2), borderColor: th.surface, borderWidth: 1.5 },
          data: rows.filter((r) => r.mine).map((r) => [r.avg_hr, 1000 / r.avg_gap]) },
        { name: 'Model (road, flat)', type: 'line', symbol: 'none', lineStyle: { width: 2, color: series(0, 2) }, itemStyle: { color: series(0, 2) }, data: line },
      ],
    });
  }).catch(() => {});
  return card;
}
