// Personal baselines for daily health signals: each day is compared with the
// user's own preceding 30 days (10th–90th percentile band, the day itself
// excluded). Shown as bands on charts, a "vs your normal" card for a day, and
// a timeline of nights where several recovery signals were unusual together.
import { h, fmtDur, fmtNum, css } from './util.js';

export const WINDOW = 30;
const MIN_POINTS = 10;

function pct(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** [{lo, mid, hi} | null] per index, from the preceding WINDOW entries. */
export function rollingBaseline(values) {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - WINDOW), i).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
    if (win.length < MIN_POINTS) return null;
    return { lo: pct(win, 0.1), mid: pct(win, 0.5), hi: pct(win, 0.9) };
  });
}

export const fmtClock = (hrs) => {
  if (hrs == null) return '–';
  const m = Math.round(((hrs % 24) + 24) % 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Signals compared with the personal baseline. `better`: which direction is favourable. */
const fmtHm = (secs) => (secs == null ? '–' : `${Math.floor(secs / 3600)} h ${String(Math.round(secs / 60) % 60).padStart(2, '0')}`);
export const SIGNALS = [
  { key: 'resting_hr', label: 'Resting heart rate', fmt: (v) => fmtNum(v), unit: 'bpm', better: 'low', recovery: true },
  { key: 'hrv_night', label: 'Overnight HRV', fmt: (v) => fmtNum(v), unit: 'ms', better: 'high', recovery: true },
  { key: 'sleep_resp', label: 'Sleep respiration', fmt: (v) => fmtNum(v, 1), unit: 'brpm', better: null, recovery: true, flagHigh: true },
  { key: 'sleep_avg_stress', label: 'Sleep stress', fmt: (v) => fmtNum(v), unit: '', better: 'low', recovery: true },
  { key: 'sleep_score', label: 'Sleep score', fmt: (v) => fmtNum(v), unit: '', better: 'high' },
  { key: 'sleep_secs', label: 'Sleep duration', fmt: fmtHm, unit: '', better: 'high' },
  { key: 'bb_wake', label: 'Body Battery at wake-up', fmt: (v) => fmtNum(v), unit: '', better: 'high' },
  { key: 'bed_time', label: 'Bedtime', fmt: fmtClock, unit: '', better: null },
];
// "clearly" unusual: beyond the band by more than this fraction of its width
// (calibrated: ≥ 2 of the 4 recovery signals then coincide on ~4.5 % of nights)
const CLEAR_MARGIN = 0.25;

/** Health rows joined with Garmin's overnight HRV (from garmin-metrics). */
export function withHrv(rows, GM) {
  const hrv = new Map((GM.hrv_night || []).map((r) => [r[0], r[1]]));
  return rows.map((r) => ({ ...r, hrv_night: hrv.get(r.date) ?? null }));
}

/** Per signal: baseline array aligned with rows. */
export function baselines(rows) {
  const out = {};
  for (const s of SIGNALS) out[s.key] = rollingBaseline(rows.map((r) => r[s.key]));
  return out;
}

function verdict(sig, v, b) {
  if (v == null || !b) return { state: 'unknown', text: 'no baseline yet' };
  const m = CLEAR_MARGIN * (b.hi - b.lo);
  if (v > b.hi) return { state: sig.better === 'low' || sig.flagHigh ? 'bad' : sig.better === 'high' ? 'good' : 'note',
    clear: v > b.hi + m, text: `${v > b.hi + m ? 'clearly ' : ''}higher than usual`, icon: '▲' };
  if (v < b.lo) return { state: sig.better === 'high' ? 'bad' : sig.better === 'low' ? 'good' : 'note',
    clear: v < b.lo - m, text: `${v < b.lo - m ? 'clearly ' : ''}lower than usual`, icon: '▼' };
  return { state: 'normal', text: 'within your normal range', icon: '●' };
}

/** "Last night vs your normal" for row index i. */
export function normalCard(rows, base, i) {
  const r = rows[i];
  const color = { bad: css('--critical'), good: css('--good'), note: css('--ink'), normal: css('--muted'), unknown: css('--muted') };
  const items = SIGNALS.map((s) => {
    const b = base[s.key][i];
    const v = r[s.key];
    const vd = verdict(s, v, b);
    return [
      h('span', { class: 'sub' }, s.label),
      h('span', { style: 'font-weight:600' }, v == null ? '–' : `${s.fmt(v)} ${s.unit}`.trim()),
      h('span', { class: 'muted' }, b ? `usual ${s.fmt(b.lo)}–${s.fmt(b.hi)} ${s.unit}`.trim() : ''),
      h('span', { style: `color:${color[vd.state]}` }, vd.icon ? `${vd.icon} ` : '', vd.text),
    ];
  });
  const bad = SIGNALS.filter((s) => verdict(s, r[s.key], base[s.key][i]).state === 'bad').map((s) => s.label.toLowerCase());
  return h('div', {},
    h('div', { class: 'sub', style: 'margin-bottom:8px' }, bad.length >= 2
      ? `Several signals are on the unfavourable side of your normal: ${bad.join(', ')}. Often seen with illness, heavy training, alcohol, travel or poor sleep — not a diagnosis.`
      : bad.length === 1 ? `One signal is outside your normal range (${bad[0]}).` : 'Everything is within or on the favourable side of your normal range.'),
    h('div', { class: 'normal-table' }, items.flat()),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' },
      `"Usual" = 10th–90th percentile of your previous ${WINDOW} days (needs ≥ ${MIN_POINTS} days of data).`));
}

/** For each row: list of recovery signals on the unfavourable side of the band. */
export function unusualSignals(rows, base) {
  const rec = SIGNALS.filter((s) => s.recovery);
  return rows.map((r, i) => rec.filter((s) => { const v = verdict(s, r[s.key], base[s.key][i]); return v.state === 'bad' && v.clear; }).map((s) => s.label));
}
