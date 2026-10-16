// Single activity: tiles, map, synced stream charts, zones, laps, splits,
// best efforts and every raw summary field.
import {
  api, h, tile, fmtDur, fmtKm, fmtNum, fmtPace, fmtKmh, fmtDate, fmtSpeedFor, speedUnit,
  usesPace, TYPE_LABEL, css, series, zoneBlock, settingsZones, dataTable, objects,
  fmtDistanceLabel, segmented, remember, zoneOf,
  osmLayer,
  dqIssues, FEEL_LABEL, parseTags, tagChips, TAG_SUGGESTIONS, postJson,
} from './util.js';
import { runModelCard } from './runmodel.js';

const ui = remember('activity', { xAxis: 'distance', extra: [] });

// Stream definitions: key → how to plot it.
const STREAMS = {
  pace:   { label: 'Pace', unit: '/km', src: 'directSpeed', smooth: 5 },
  speed:  { label: 'Speed', unit: 'km/h', src: 'directSpeed', smooth: 3, f: (v) => v * 3.6 },
  gap:    { label: 'Grade-adjusted pace', unit: '/km', src: 'directGradeAdjustedSpeed', smooth: 5 },
  hr:     { label: 'Heart rate', unit: 'bpm', src: 'directHeartRate' },
  elev:   { label: 'Elevation', unit: 'm', src: 'directElevation' },
  cad:    { label: 'Cadence', unit: 'spm', src: 'directDoubleCadence', smooth: 3 },
  bikecad:{ label: 'Cadence', unit: 'rpm', src: 'directBikeCadence', smooth: 3 },
  power:  { label: 'Power', unit: 'W', src: 'directPower', smooth: 5 },
  stride: { label: 'Stride length', unit: 'cm', src: 'directStrideLength', smooth: 5 },
  gct:    { label: 'Ground contact time', unit: 'ms', src: 'directGroundContactTime', smooth: 5 },
  vo:     { label: 'Vertical oscillation', unit: 'cm', src: 'directVerticalOscillation', smooth: 5 },
  vr:     { label: 'Vertical ratio', unit: '%', src: 'directVerticalRatio', smooth: 5 },
  gcb:    { label: 'GCT balance (left)', unit: '%', src: 'directGroundContactBalanceLeft', smooth: 5 },
  resp:   { label: 'Respiration', unit: 'brpm', src: 'directRespirationRate' },
  stamina:{ label: 'Stamina', unit: '%', src: 'directAvailableStamina' },
  perf:   { label: 'Performance condition', unit: '', src: 'directPerformanceCondition' },
  temp:   { label: 'Temperature', unit: '°C', src: 'directAirTemperature' },
  vspeed: { label: 'Vertical speed', unit: 'm/min', src: 'directVerticalSpeed', smooth: 5, f: (v) => v * 60 },
  bb:     { label: 'Body Battery', unit: '', src: 'directBodyBattery' },
};

function smooth(xs, w) {
  if (!w || w < 2) return xs;
  const out = new Array(xs.length);
  let sum = 0, n = 0;
  const half = Math.floor(w / 2);
  // centered moving average ignoring nulls
  for (let i = 0; i < xs.length; i++) {
    sum = 0; n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(xs.length - 1, i + half); j++) {
      if (xs[j] != null) { sum += xs[j]; n++; }
    }
    out[i] = n ? sum / n : null;
  }
  return out;
}

export async function activityPage(app, id) {
  const [d, st] = await Promise.all([api(`activity/${id}`), api(`activity/${id}/streams`)]);
  const a = d.activity;
  const meta = d.meta || {};
  const fam = a.parent_type;
  const sum = meta.activity?.summaryDTO || {};
  const Z = settingsZones(d.settings);
  const disposers = [];
  const gapEst = a.gap_source === 'estimated';
  const gapLabel = gapEst ? 'Grade-adjusted pace (estimated)' : 'Grade-adjusted pace';

  // ── header + tiles ──
  const head = h('div', { class: 'page-head' },
    h('h1', {}, a.name || TYPE_LABEL(a.type_key)),
    h('span', { class: 'chip' }, TYPE_LABEL(a.type_key)),
    h('span', { class: 'sub' }, fmtDate(a.start_local, true)),
    a.location ? h('span', { class: 'sub' }, a.location) : null,
    a.gear ? h('span', { class: 'muted' }, a.gear) : null,
    d.route && d.route.n >= 2 ? h('a', { href: `#/route/${d.route.route_id}`, class: 'chip', title: 'Repeated route' },
      `Route: ${d.route.n} times · #${d.route.rank} by time`) : null,
    h('a', { href: `https://connect.garmin.com/modern/activity/${a.id}`, target: '_blank', rel: 'noopener', class: 'muted' }, 'Garmin ↗'));

  const tiles = h('div', { class: 'tiles', style: 'margin-bottom:16px' },
    a.distance ? tile('Distance', fmtKm(a.distance), 'km') : null,
    tile('Moving time', fmtDur(a.moving_duration)),
    tile('Elapsed', fmtDur(a.elapsed_duration)),
    a.distance ? tile(usesPace(fam) ? 'Avg pace' : 'Avg speed', fmtSpeedFor(fam, a.avg_moving_speed), speedUnit(fam)) : null,
    a.avg_gap_speed ? tile(a.gap_source === 'estimated' ? 'Avg GAP (estimated)' : 'Avg GAP', fmtPace(a.avg_gap_speed), '/km') : null,
    a.avg_hr ? tile('Avg / max HR', `${fmtNum(a.avg_hr)} / ${fmtNum(a.max_hr)}`, 'bpm') : null,
    a.elev_gain != null ? tile('Ascent / descent', `${fmtNum(a.elev_gain)} / ${fmtNum(a.elev_loss)}`, 'm') : null,
    a.ascent_per_km != null ? tile('Ascent per km', fmtNum(a.ascent_per_km, 1), 'm') : null,
    a.avg_cadence ? tile('Cadence', fmtNum(a.avg_cadence), fam === 'cycling' ? 'rpm' : 'spm') : null,
    a.avg_power ? tile('Power avg / NP', `${fmtNum(a.avg_power)} / ${fmtNum(a.norm_power)}`, 'W') : null,
    a.avg_stride ? tile('Stride', fmtNum(a.avg_stride), 'cm') : null,
    a.aerobic_te != null ? tile('Training effect', `${fmtNum(a.aerobic_te, 1)} / ${fmtNum(a.anaerobic_te, 1)}`) : null,
    a.training_load != null ? tile('Load', fmtNum(a.training_load)) : null,
    a.decoupling != null ? h('div', { class: 'tile', title: 'Efficiency (grade-adjusted speed ÷ HR) of the 2nd half vs the 1st half, after a 10 min warm-up. Below ~5 % on steady runs = good aerobic endurance; negative = 2nd half more efficient.' },
      h('div', { class: 'k' }, 'Aerobic decoupling'),
      h('div', { class: 'v' }, `${a.decoupling > 0 ? '+' : ''}${fmtNum(a.decoupling, 1)}`, h('span', { class: 'u' }, '%')),
      h('div', { class: 'muted', style: 'font-size:11px' }, a.decoupling_steady ? 'steady run' : `not steady (±${fmtNum(a.pace_cv * 100)} % pace) — hard to interpret`)) : null,
    a.rpe != null || a.feel != null ? tile('Perceived effort', a.rpe != null ? `${fmtNum(a.rpe)} / 10` : '–', FEEL_LABEL(a.feel) ? `felt ${FEEL_LABEL(a.feel)}` : '') : null,
    a.calories ? tile('Calories', fmtNum(a.calories), 'kcal') : null,
    a.w_temp != null ? tile('Weather', `${fmtNum(a.w_temp)}°C`, [a.w_type, a.w_humidity != null ? `${fmtNum(a.w_humidity)}%` : null,
      a.w_wind_speed != null ? `wind ${fmtNum(a.w_wind_speed * 3.6)} km/h ${a.w_wind_dir || ''}` : null].filter(Boolean).join(' · ')) : null);

  // ── x axis ──
  const t = st.t || [];
  const dist = st.sumDistance;
  const hasDist = dist && dist.some((x) => x > 0);
  let xMode = hasDist ? ui.get().xAxis : 'time';
  const lat = st.directLatitude, lon = st.directLongitude;
  const hasGps = lat && lat.some((x) => x != null && x !== 0);

  // ── map ──
  const mapEl = h('div', { id: 'map' });
  let marker = null, map = null, line = null, highlight = null;
  const pts = [];
  if (hasGps) {
    for (let i = 0; i < t.length; i++) if (lat[i] != null && lon[i] != null && lat[i] !== 0) pts.push([lat[i], lon[i], i]);
  }

  // ── stream charts ──
  const available = Object.entries(STREAMS).filter(([k, s]) => st[s.src] && st[s.src].some((v) => v != null && v !== 0));
  const defaults = (usesPace(fam) ? ['pace', 'gap'] : ['speed']).concat(['hr', 'elev', 'cad', 'bikecad', 'power']);
  const chosenKeys = () => available.map(([k]) => k).filter((k) => defaults.includes(k) || ui.get().extra.includes(k));
  const chartsEl = h('div', { class: 'stream-charts' });
  let plots = [];

  function xData() {
    if (xMode === 'distance') {
      let last = 0;
      return dist.map((v) => (v == null ? last : (last = v / 1000)));
    }
    return t.map((v) => v);
  }
  function drawCharts() {
    plots.forEach((p) => p.destroy());
    plots = [];
    chartsEl.replaceChildren();
    const xs = xData();
    const width = chartsEl.clientWidth || 900;
    const syncKey = 'act-' + id;
    let syncingScale = false;
    for (const [i, k] of chosenKeys().entries()) {
      const s = STREAMS[k];
      let ys = st[s.src].map((v) => (v == null ? null : s.f ? s.f(v) : v));
      ys = smooth(ys, s.smooth);
      const isPace = s.unit === '/km';
      if (isPace) ys = ys.map((v) => (v != null && v > 0.5 ? 1000 / v : null)); // s/km
      // robust y range for pace: ignore stopped / GPS spikes
      let range = undefined;
      if (isPace) {
        const vals = ys.filter((v) => v != null).sort((p, q) => p - q);
        const lo = vals[Math.floor(vals.length * 0.01)] ?? 180, hi = vals[Math.floor(vals.length * 0.97)] ?? 600;
        range = [Math.max(120, lo - 15), Math.min(1200, hi + 30)];
      }
      const color = series(i % 8);
      const el = h('div', { class: 'card', style: 'padding:8px 8px 0;margin-bottom:8px' });
      chartsEl.append(el);
      const opts = {
        title: `${k === 'gap' ? gapLabel : s.label}${s.unit ? ' (' + s.unit + ')' : ''}`,
        width: el.clientWidth - 16 || width, height: 170,
        cursor: { sync: { key: syncKey, setSeries: false }, drag: { x: true, y: false } },
        legend: { show: true, live: true },
        scales: { x: { time: false }, y: isPace ? { dir: -1, range: () => range } : { auto: true } },
        axes: [
          { stroke: css('--muted'), grid: { stroke: css('--grid'), width: 1 }, ticks: { show: false },
            values: (u, v) => v.map((x) => (xMode === 'distance' ? x.toFixed(1) : fmtDur(x))) },
          { stroke: css('--muted'), grid: { stroke: css('--grid'), width: 1 }, ticks: { show: false }, size: 56,
            values: (u, v) => v.map((x) => (isPace ? fmtDur(x) : +x.toFixed(1))) },
        ],
        series: [
          { label: xMode === 'distance' ? 'km' : 'time', value: (u, v) => (v == null ? '–' : xMode === 'distance' ? v.toFixed(2) : fmtDur(v)) },
          { label: s.label, stroke: color, width: 1.5, fill: k === 'elev' ? color + '22' : undefined,
            value: (u, v) => (v == null ? '–' : isPace ? fmtDur(v) : v.toFixed(s.unit === 'cm' || s.unit === '%' ? 1 : 0)), spanGaps: false, points: { show: false } },
        ],
        hooks: {
          setCursor: [(u) => { if (u.cursor.idx != null) moveMarker(u.cursor.idx); }],
          setScale: [(u, key) => {
            if (key !== 'x' || syncingScale) return;
            syncingScale = true;
            const { min, max } = u.scales.x;
            plots.forEach((p) => p !== u && p.setScale('x', { min, max }));
            highlightRange(min, max, xs);
            syncingScale = false;
          }],
        },
      };
      const p = new uPlot(opts, [xs, ys], el);
      plots.push(p);
    }
  }
  function moveMarker(idx) {
    if (!map || !hasGps) return;
    let j = idx;
    while (j > 0 && (lat[j] == null || lat[j] === 0)) j--;
    if (lat[j] == null) return;
    if (!marker) marker = L.circleMarker([lat[j], lon[j]], { radius: 6, color: css('--surface'), weight: 2, fillColor: css('--s2'), fillOpacity: 1 }).addTo(map);
    else marker.setLatLng([lat[j], lon[j]]);
  }
  // ── statistics for the zoomed selection ──
  const selEl = h('div', { class: 'card', style: 'margin-bottom:8px', hidden: true });
  function selectionStats(min, max, xs) {
    const full = min <= xs[0] && max >= xs[xs.length - 1];
    if (full) { selEl.hidden = true; return; }
    let i0 = xs.findIndex((x) => x >= min), i1 = xs.length - 1;
    while (i1 > 0 && xs[i1] > max) i1--;
    if (i0 < 0 || i1 <= i0) { selEl.hidden = true; return; }
    const S = (k) => st[k] || [];
    const tt = S('t'), dd = S('sumDistance'), mv = S('sumMovingDuration'), el = S('directElevation');
    const val = (arr, i) => (arr[i] == null ? null : arr[i]);
    // time-weighted mean over samples (each sample holds until the next, gaps > 10 s ignored)
    const wmean = (arr) => {
      let s1 = 0, w = 0;
      for (let i = i0; i < i1; i++) {
        const dt = tt[i + 1] - tt[i];
        if (arr[i] == null || !(dt > 0) || dt > 10) continue;
        s1 += arr[i] * dt; w += dt;
      }
      return w ? s1 / w : null;
    };
    const maxOf = (arr) => { let m = null; for (let i = i0; i <= i1; i++) if (arr[i] != null && (m == null || arr[i] > m)) m = arr[i]; return m; };
    const dist = dd.length ? (val(dd, i1) ?? 0) - (val(dd, i0) ?? 0) : null;
    const elapsed = tt[i1] - tt[i0];
    const moving = mv.length && mv[i1] != null && mv[i0] != null ? mv[i1] - mv[i0] : elapsed;
    let up = 0, down = 0;
    for (let i = i0; i < i1; i++) {
      if (el[i] == null || el[i + 1] == null) continue;
      const dz = el[i + 1] - el[i];
      if (dz > 0) up += dz; else down -= dz;
    }
    const gap = wmean(S('directGradeAdjustedSpeed'));
    const hrAvg = wmean(S('directHeartRate')), hrMax = maxOf(S('directHeartRate'));
    const cadArr = S('directDoubleCadence').length ? S('directDoubleCadence') : S('directBikeCadence');
    const pw = wmean(S('directPower'));
    const speed = dist != null && moving > 0 ? dist / moving : null;
    const where = xMode === 'distance' ? `km ${(+min).toFixed(2)}–${(+max).toFixed(2)}` : `${fmtDur(min)}–${fmtDur(max)}`;
    selEl.hidden = false;
    selEl.replaceChildren(
      h('div', { class: 'filters', style: 'margin-bottom:8px;align-items:baseline' },
        h('h3', { style: 'margin:0' }, `Selection · ${where}`),
        h('button', { onclick: () => { for (const p of plots) p.setScale('x', { min: xs[0], max: xs[xs.length - 1] }); } }, 'Reset zoom')),
      h('div', { class: 'tiles' },
        dist != null ? tile('Distance', fmtKm(dist), 'km') : null,
        tile('Moving / elapsed', `${fmtDur(moving)} / ${fmtDur(elapsed)}`),
        speed ? tile(usesPace(fam) ? 'Pace' : 'Speed', fmtSpeedFor(fam, speed), speedUnit(fam)) : null,
        gap ? tile(gapEst ? 'GAP (est.)' : 'GAP', fmtPace(gap), '/km') : null,
        hrAvg ? tile('HR avg / max', `${fmtNum(hrAvg)} / ${fmtNum(hrMax)}`, 'bpm') : null,
        el.length ? tile('Ascent / descent', `${fmtNum(up)} / ${fmtNum(down)}`, 'm') : null,
        dist > 50 && el.length && el[i1] != null && el[i0] != null ? tile('Net grade', fmtNum((el[i1] - el[i0]) / dist * 100, 1), '%') : null,
        wmean(cadArr) ? tile('Cadence', fmtNum(wmean(cadArr)), fam === 'cycling' ? 'rpm' : 'spm') : null,
        pw ? tile('Power', fmtNum(pw), 'W') : null));
  }

  function highlightRange(min, max, xs) {
    selectionStats(min, max, xs);
    if (!map) return;
    if (highlight) { highlight.remove(); highlight = null; }
    if (min <= xs[0] && max >= xs[xs.length - 1]) return;
    const seg = pts.filter((p) => xs[p[2]] >= min && xs[p[2]] <= max).map((p) => [p[0], p[1]]);
    if (seg.length > 1) highlight = L.polyline(seg, { color: css('--s2'), weight: 5, opacity: 0.9 }).addTo(map);
  }

  // ── zones ──
  const hrSecs = new Array(Z.hrFloors.length + 1).fill(0);
  for (const [bpm, secs] of d.hrHist.rows) hrSecs[zoneOf(bpm, Z.hrFloors)] += secs;
  const paceSecs = new Array(Z.speedFloors.length + 1).fill(0);
  const gapSecs = new Array(Z.speedFloors.length + 1).fill(0);
  for (const [bucket, secs, gsecs] of d.speedHist.rows) {
    const v = bucket * 0.05;
    paceSecs[zoneOf(v, Z.speedFloors)] += secs;
    gapSecs[zoneOf(v, Z.speedFloors)] += gsecs;
  }
  // pace zone 0 (below the Z1 floor of 0) is empty by construction
  if (Z.speedFloors[0] <= 0) { paceSecs.shift(); gapSecs.shift(); }
  const paceNames = Z.speedFloors[0] <= 0 ? Z.paceNames.slice(1) : Z.paceNames;
  const paceLabels = Z.speedFloors[0] <= 0 ? Z.paceLabels.slice(1) : Z.paceLabels;
  const zoneCards = h('div', { class: 'grid cols-3', style: 'margin-bottom:16px' },
    d.hrHist.rows.length ? h('div', { class: 'card' }, zoneBlock('Heart-rate zones', hrSecs, Z.hrNames, Z.hrLabels)) : null,
    usesPace(fam) && d.speedHist.rows.length ? h('div', { class: 'card' }, zoneBlock('Pace zones', paceSecs, paceNames, paceLabels, Z.speedFloors[0] <= 0 ? 1 : 0)) : null,
    usesPace(fam) && gapSecs.some((x) => x > 0) ? h('div', { class: 'card' }, zoneBlock(gapEst ? 'Grade-adjusted pace zones (estimated)' : 'Grade-adjusted pace zones', gapSecs, paceNames, paceLabels, Z.speedFloors[0] <= 0 ? 1 : 0)) : null);

  // ── laps / splits / efforts ──
  const laps = objects(d.laps);
  const lapTable = laps.length > 1 ? h('div', { class: 'card' }, h('h2', {}, 'Laps'), dataTable(laps, [
    { key: 'idx', label: '#', fmt: (v) => v + 1, defaultAsc: true },
    { key: 'distance', label: 'km', fmt: (v) => fmtKm(v) },
    { key: 'moving_duration', label: 'Time', fmt: fmtDur },
    { key: 'avg_speed', label: usesPace(fam) ? 'Pace' : 'Speed', fmt: (v) => fmtSpeedFor(fam, v) },
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    { key: 'max_hr', label: 'Max', fmt: (v) => fmtNum(v) },
    { key: 'avg_cadence', label: 'Cad', fmt: (v) => fmtNum(v) },
    { key: 'avg_power', label: 'W', fmt: (v) => fmtNum(v) },
    { key: 'elev_gain', label: '↑', fmt: (v) => fmtNum(v) },
    { key: 'elev_loss', label: '↓', fmt: (v) => fmtNum(v) },
  ], { sortKey: 'idx', sortDesc: false })) : null;

  const segs = objects(d.segments);
  const splitTable = segs.length ? h('div', { class: 'card' }, h('h2', {}, 'Kilometre splits'), dataTable(segs, [
    { key: 'idx', label: 'km', fmt: (v) => v + 1, defaultAsc: true },
    { key: 'time', label: 'Time', fmt: fmtDur },
    { key: 'avg_speed', label: usesPace(fam) ? 'Pace' : 'Speed', fmt: (v) => fmtSpeedFor(fam, v) },
    usesPace(fam) ? { key: 'avg_gap', label: gapEst ? 'GAP (est.)' : 'GAP', fmt: (v) => fmtPace(v) } : null,
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    { key: 'grade', label: 'Grade %', fmt: (v) => fmtNum(v, 1) },
    { key: 'ascent', label: '↑', fmt: (v) => fmtNum(v) },
    { key: 'descent', label: '↓', fmt: (v) => fmtNum(v) },
    { key: 'avg_cadence', label: 'Cad', fmt: (v) => fmtNum(v) },
    { key: 'avg_power', label: 'W', fmt: (v) => fmtNum(v) },
  ].filter(Boolean), { sortKey: 'idx', sortDesc: false })) : null;

  const efforts = objects(d.efforts);
  const effortTable = efforts.length ? h('div', { class: 'card' }, h('h2', {}, 'Best efforts in this activity'), dataTable(efforts, [
    { key: 'distance', label: 'Distance', fmt: fmtDistanceLabel, defaultAsc: true },
    { key: 'time', label: 'Time', fmt: fmtDur },
    { key: 'pace', label: usesPace(fam) ? 'Pace' : 'Speed', fmt: (v, r) => fmtSpeedFor(fam, r.distance / r.time), sortVal: (r) => r.distance / r.time },
    { key: 'avg_hr', label: 'HR', fmt: (v) => fmtNum(v) },
    { key: 'elev_gain', label: '↑ m', fmt: (v) => fmtNum(v) },
    { key: 'start_dist', label: 'from km', fmt: (v) => fmtKm(v) },
    { key: 'rank', label: 'All-time rank', fmt: (v) => (v === 1 ? '🏆 1' : `#${v}`) },
  ], { sortKey: 'distance', sortDesc: false })) : null;

  const hrr = objects(d.hrRecovery || { cols: [], rows: [] });
  const hrrTable = hrr.length ? h('div', { class: 'card' }, h('h2', {}, 'Heart-rate recovery'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, 'Where the run clearly eased off a hard stretch: HR drop from the peak. Trend on the Performance page.'),
    dataTable(hrr, [
      { key: 't_end', label: 'At', fmt: fmtDur, defaultAsc: true },
      { key: 'effort_secs', label: 'Effort', fmt: fmtDur },
      { key: 'effort_speed', label: 'GAP before', fmt: (v) => fmtPace(v) },
      { key: 'peak_hr', label: 'Peak HR', fmt: (v) => fmtNum(v) },
      { key: 'drop60', label: '−60 s', fmt: (v) => (v == null ? '–' : `−${fmtNum(v)}`) },
      { key: 'drop120', label: '−120 s', fmt: (v) => (v == null ? '–' : `−${fmtNum(v)}`),
        title: (r) => (r.drop120 == null ? 'next effort started within 2 min' : null) },
      { key: 'post_speed', label: 'Then', fmt: (v) => (v < 1.6 ? `walk ${fmtPace(v)}` : `jog ${fmtPace(v)}`) },
    ], { sortKey: 't_end', sortDesc: false })) : null;

  // ── every summary field ──
  const kv = h('dl', { class: 'kv' }, Object.entries(sum).filter(([, v]) => v != null && typeof v !== 'object')
    .flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]));
  const rawDetails = h('details', { class: 'card' }, h('summary', {}, 'All Garmin summary fields & raw metadata'),
    h('div', { class: 'grid cols-2', style: 'margin-top:12px' }, kv,
      h('pre', { class: 'json' }, JSON.stringify(meta, null, 1))));

  // ── layout ──
  const extraPicker = h('div', { class: 'filters' },
    hasDist ? h('label', {}, 'X axis', segmented([['distance', 'Distance'], ['time', 'Time']], xMode, (v) => { xMode = v; ui.set({ xAxis: v }); drawCharts(); })) : null,
    h('label', {}, 'More charts', h('span', { style: 'display:flex;flex-wrap:wrap;gap:4px' },
      available.filter(([k]) => !defaults.includes(k)).map(([k, s]) => {
        const on = ui.get().extra.includes(k);
        return h('button', { class: on ? 'primary' : '', onclick: (e) => {
          const ex = new Set(ui.get().extra);
          ex.has(k) ? ex.delete(k) : ex.add(k);
          ui.set({ extra: [...ex] });
          e.target.classList.toggle('primary');
          drawCharts();
        } }, s.label);
      }))),
    h('span', { class: 'muted' }, 'Drag on a chart to select a section: charts zoom, the map highlights it and its statistics appear above (double-click resets).'));

  const modelCard = await runModelCard(a, d.model, d.modelNoise);
  // ── notes & tags (Org file; Garmin's own description read-only) ──
  const notesCard = h('div', { class: 'card notes-card', style: 'margin-bottom:16px' });
  let note = { tags: parseTags(d.notes?.tags), note: d.notes?.note || '' };
  const garminDesc = meta.activity?.description;
  function showNotes() {
    const empty = !note.tags.length && !note.note;
    notesCard.replaceChildren(...[
      h('div', { class: 'notes-head' }, h('h2', { style: 'margin:0' }, 'Notes'),
        ...tagChips(note.tags, (t) => { location.hash = `#/activities?tag=${encodeURIComponent(t)}`; }),
        h('button', { onclick: editNotes }, empty ? '+ Add note / tags' : 'Edit')),
      note.note ? h('div', { class: 'note-text' }, note.note) : (empty ? h('div', { class: 'muted' }, 'No note yet.') : null),
      garminDesc ? h('div', { class: 'note-text muted' }, h('b', {}, 'Garmin: '), garminDesc) : null].filter(Boolean));
  }
  async function editNotes() {
    const known = await api('tags').catch(() => ({ tags: [] }));
    let tags = [...note.tags];
    const chipsEl = h('span', { class: 'tag-edit' });
    const input = h('input', { type: 'text', placeholder: 'add tag…', list: 'tag-list', style: 'width:140px' });
    const add = (t) => { t = t.trim().toLowerCase().replace(/[^\w@#%]+/g, '_').replace(/^_+|_+$/g, ''); if (t && !tags.includes(t)) tags.push(t); drawChips(); };
    const drawChips = () => chipsEl.replaceChildren(...tags.map((t) => h('span', { class: 'tag' }, t,
      h('button', { class: 'tag-x', title: 'remove', onclick: () => { tags = tags.filter((x) => x !== t); drawChips(); } }, '×'))));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.value = ''; }
      else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); drawChips(); }
    });
    input.addEventListener('change', () => { if (input.value) { add(input.value); input.value = ''; } });
    const counts = new Map(known.tags);
    const sugg = TAG_SUGGESTIONS.map(([group, ts]) => h('div', { class: 'tag-sugg' }, h('span', { class: 'muted' }, group),
      ...[...new Set([...ts, ...[...counts.keys()].filter((t) => group === 'Workout' && !TAG_SUGGESTIONS.some(([, xs]) => xs.includes(t)))])]
        .map((t) => h('button', { class: 'tag ghost', onclick: () => add(t), title: counts.has(t) ? `used ${counts.get(t)}×` : 'suggestion' }, t))));
    const text = h('textarea', { rows: 6, placeholder: 'How did it go? (Org text — saved to the notes file)' });
    text.value = note.note;
    const status = h('span', { class: 'muted' });
    const save = async () => {
      if (input.value) { add(input.value); input.value = ''; }
      status.textContent = 'Saving…';
      try {
        const r = await postJson(`activity/${a.id}/notes`, { tags, note: text.value, base: note });
        note = { tags: parseTags(r?.tags), note: r?.note || '' };
        showNotes();
      } catch (e) {
        let msg = e.message;
        try {
          const j = JSON.parse(msg);
          if (j.current) {
            // someone edited the Org file meanwhile: take that as the new base, keep the user's text in the form
            note = { tags: parseTags(j.current.tags), note: j.current.note || '' };
            msg = `${j.error} — now: [${note.tags.join(', ')}] "${note.note.slice(0, 80)}". Save again to overwrite it.`;
          }
        } catch {}
        status.textContent = msg;
      }
    };
    notesCard.replaceChildren(
      h('div', { class: 'notes-head' }, h('h2', { style: 'margin:0' }, 'Notes'), chipsEl, input,
        h('datalist', { id: 'tag-list' }, [...counts.keys()].map((t) => h('option', { value: t })))),
      ...sugg, text,
      h('div', { class: 'notes-head' }, h('button', { class: 'primary', onclick: save }, 'Save'),
        h('button', { onclick: showNotes }, 'Cancel'), status,
        h('span', { class: 'muted', style: 'font-size:11px' }, known.file ? `→ ${known.file}` : '')));
    drawChips();
    input.focus();
  }
  showNotes();

  const issues = dqIssues(a.dq_flags);
  const dqNote = issues.length ? h('div', { class: 'card dq-note' }, h('b', {}, '⚠ Data quality'),
    h('ul', {}, issues.map((x) => h('li', {}, x))),
    JSON.parse(a.dq_flags).duplicate_of ? h('a', { href: `#/activity/${JSON.parse(a.dq_flags).duplicate_of}` }, 'Open the kept copy →') : null) : '';
  app.replaceChildren(head, tiles, notesCard, dqNote, modelCard ?? '', zoneCards,
    h('div', { class: 'grid', style: `grid-template-columns:${hasGps ? 'minmax(0,5fr) minmax(0,6fr)' : '1fr'};margin-bottom:16px;align-items:start` },
      hasGps ? h('div', { class: 'card', style: 'position:sticky;top:60px' }, mapEl) : null,
      h('div', {}, t.length ? extraPicker : h('div', { class: 'empty' }, 'No time-series data for this activity (yet).'), selEl, chartsEl)),
    h('div', { class: 'grid cols-2', style: 'margin-bottom:16px;align-items:start' }, splitTable, lapTable, effortTable, hrrTable),
    rawDetails);

  if (hasGps) {
    map = L.map(mapEl, { scrollWheelZoom: true });
    osmLayer().addTo(map);
    line = L.polyline(pts.map((p) => [p[0], p[1]]), { color: css('--s1'), weight: 3 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [16, 16] });
    L.circleMarker(pts[0], { radius: 5, color: css('--good'), fillOpacity: 1 }).addTo(map).bindTooltip('Start');
    L.circleMarker(pts[pts.length - 1], { radius: 5, color: css('--critical'), fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
    // hover on map → move chart cursors
    map.on('mousemove', (e) => {
      let best = null, bd = Infinity;
      for (const p of pts) {
        const dd = (p[0] - e.latlng.lat) ** 2 + (p[1] - e.latlng.lng) ** 2;
        if (dd < bd) { bd = dd; best = p; }
      }
      if (!best) return;
      const xs = plots[0]?.data[0];
      for (const p of plots) p.setCursor({ left: p.valToPos(xs[best[2]], 'x'), top: 10 });
    });
  }
  if (t.length) drawCharts();
  const onResize = () => { for (const p of plots) p.setSize({ width: p.root.parentElement.clientWidth - 16, height: 170 }); };
  window.addEventListener('resize', onResize);
  disposers.push(() => window.removeEventListener('resize', onResize), () => plots.forEach((p) => p.destroy()), () => map?.remove());
  return () => disposers.forEach((f) => f());
}
