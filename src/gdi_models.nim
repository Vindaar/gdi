## gdi_models — derived models over the whole history (recomputed after imports).
##
## Expected-pace model ("faster/slower than expected")
## ---------------------------------------------------
## For each run, a weighted least-squares fit over the 1 km running segments of
## the preceding `WindowDays` (extended back to at most `FallbackDays` when
## that holds fewer than `MinWindowSegs` segments) predicts grade-adjusted
## speed from
##
##   speed ≈ a + b·HR + c·hoursIntoRun + d·trail + e·(ascent+descent)/100 m
##
## (first km skipped for HR lag, |grade| ≤ 10 %, two passes of 2.5σ outlier
## trimming, light ridge on the terrain/drift terms, HR slope shrunk towards
## the all-history slope — which also made it slightly more accurate). The run's score is the
## median over its own segments of actual − expected pace in s/km (negative =
## faster than expected). Out-of-sample on this history: median |score|
## ≈ 17 s/km vs ≈ 19 for a rolling speed/HR ratio and ≈ 23 for HR alone;
## sleep score and resting-HR deviation showed no relation to the residuals,
## temperature only a weak one, so they are shown as context, not modelled.

import std / [math, algorithm, times, strutils, json, tables]
import gdi_db

const
  WindowDays = 120.0
  FallbackDays = 365.0
  MinWindowSegs = 150
  MinFallbackSegs = 100
  NFeat = 5                 ## 1, hr, hours, trail, updn
  Ridge = 0.1               ## on the drift/terrain coefficients
  RefHr* = 140.0            ## reference conditions for the fitness trend
  SlopePrior = 200.0        ## pull of the HR slope towards the all-history
                            ## slope, in "segments" — small windows otherwise
                            ## let one hard session swing slope and intercept

type
  Seg = object
    act: int
    day: float              ## days since epoch (activity start)
    hr, speed, weight, hours, trail, updn, temp: float

proc features(s: Seg): array[NFeat, float] =
  [1.0, s.hr, s.hours, s.trail, s.updn]

proc solve(m: var array[NFeat, array[NFeat, float]], v: var array[NFeat, float]): array[NFeat, float] =
  ## Gaussian elimination with partial pivoting (tiny system).
  for col in 0 ..< NFeat:
    var piv = col
    for r in col + 1 ..< NFeat:
      if abs(m[r][col]) > abs(m[piv][col]): piv = r
    swap(m[col], m[piv]); swap(v[col], v[piv])
    if abs(m[col][col]) < 1e-12: return
    for r in 0 ..< NFeat:
      if r == col: continue
      let f = m[r][col] / m[col][col]
      for c in col ..< NFeat: m[r][c] -= f * m[col][c]
      v[r] -= f * v[col]
  for i in 0 ..< NFeat: result[i] = v[i] / m[i][i]

proc fitWindow(segs: openArray[Seg], slope0 = NaN): (array[NFeat, float], int) =
  ## Weighted LSQ with ridge on terms 2.., two passes of 2.5σ trimming, and
  ## (when `slope0` is given) a prior pulling the HR slope towards it.
  var keep = newSeq[bool](segs.len)
  for i in 0 ..< keep.len: keep[i] = true
  var beta: array[NFeat, float]
  var used = 0
  for pass in 0 .. 2:
    var m: array[NFeat, array[NFeat, float]]
    var v: array[NFeat, float]
    var wsum = 0.0
    used = 0
    for i, s in segs:
      if not keep[i]: continue
      let x = s.features
      for r in 0 ..< NFeat:
        for c in 0 ..< NFeat: m[r][c] += s.weight * x[r] * x[c]
        v[r] += s.weight * x[r] * s.speed
      wsum += s.weight
      inc used
    for k in 2 ..< NFeat: m[k][k] += Ridge * wsum / max(1, used).float
    if not slope0.isNaN and used > 1:
      var hm, hv = 0.0
      for i, s in segs:
        if keep[i]: hm += s.weight * s.hr
      hm /= wsum
      for i, s in segs:
        if keep[i]: hv += s.weight * (s.hr - hm) ^ 2
      hv /= wsum
      let L = SlopePrior * hv * wsum / used.float
      m[1][1] += L
      v[1] += L * slope0
    beta = solve(m, v)
    if pass == 2: break
    # residual σ and trimming for the next pass
    var ss, ws = 0.0
    for i, s in segs:
      if not keep[i]: continue
      let x = s.features
      var p = 0.0
      for k in 0 ..< NFeat: p += beta[k] * x[k]
      ss += s.weight * (s.speed - p) ^ 2; ws += s.weight
    let sd = sqrt(ss / max(ws, 1e-9))
    for i, s in segs:
      let x = s.features
      var p = 0.0
      for k in 0 ..< NFeat: p += beta[k] * x[k]
      keep[i] = abs(s.speed - p) < 2.5 * sd
  (beta, used)

proc predict(beta: array[NFeat, float], s: Seg): float =
  let x = s.features
  for k in 0 ..< NFeat: result += beta[k] * x[k]

proc median(xs: var seq[float]): float =
  if xs.len == 0: return NaN
  xs.sort()
  let n = xs.len
  if n mod 2 == 1: xs[n div 2] else: (xs[n div 2 - 1] + xs[n div 2]) / 2

proc dayOf(iso: string): float =
  try:
    let t = parse(iso[0 ..< min(19, iso.len)], "yyyy-MM-dd'T'HH:mm:ss", utc())
    t.toTime.toUnixFloat / 86400.0
  except CatchableError: NaN

proc computeRunModel*(db: DbConn) =
  ## Rebuild `run_model` for every run with usable segments.
  var segs: seq[Seg]
  for r in db.rows(sql"""SELECT s.activity_id, a.start_local, s.avg_hr, s.avg_gap, s.time,
        s.start_t, a.type_key, COALESCE(s.ascent, 0) + COALESCE(s.descent, 0), s.idx,
        COALESCE(s.grade, 0), a.w_temp
      FROM segments s JOIN activities a ON a.id = s.activity_id
      WHERE a.parent_type = 'running' AND s.avg_gap > 0 AND s.avg_hr > 0
      ORDER BY a.start_local, s.idx"""):
    let hr = parseFloat(r[2]); let sp = parseFloat(r[3]); let idx = parseInt(r[8])
    if idx < 1 or hr < 100 or hr > 200 or sp <= 1.5 or sp >= 7 or abs(parseFloat(r[9])) > 10:
      continue
    segs.add Seg(act: parseInt(r[0]), day: dayOf(r[1]), hr: hr, speed: sp,
                 weight: parseFloat(r[4]), hours: parseFloat(r[5]) / 3600,
                 trail: (if r[6] == "trail_running": 1.0 else: 0.0),
                 updn: parseFloat(r[7]) / 100,
                 temp: (if r[10].len > 0: parseFloat(r[10]) else: NaN))
  # group by activity (segs are ordered by start)
  var order: seq[int]
  var byAct = initOrderedTable[int, seq[int]]()
  for i, s in segs:
    if s.act notin byAct: order.add s.act
    byAct.mgetOrPut(s.act, @[]).add i
  # long-term personal HR slope (all history) as the prior for every window
  let slope0 = if segs.len >= MinFallbackSegs: fitWindow(segs)[0][1] else: NaN
  db.exec(sql"BEGIN")
  db.exec(sql"DELETE FROM run_model")
  var allScores: seq[float]
  var lo = 0
  for act in order:
    let mine = byAct[act]
    let d0 = segs[mine[0]].day
    # window: segments strictly before this run
    var hi = mine[0]
    var start = lo
    while start < hi and segs[start].day < d0 - FallbackDays: inc start
    lo = start
    # 120 days, extended back (≤ 365 d) only as far as needed for enough
    # segments — avoids jumps from switching between two fixed windows
    var winStart = start
    while winStart < hi and segs[winStart].day < d0 - WindowDays: inc winStart
    if hi - winStart < MinWindowSegs:
      winStart = max(start, hi - MinWindowSegs)
    if hi - winStart < MinFallbackSegs: continue
    let days = d0 - segs[winStart].day
    let (beta, used) = fitWindow(segs.toOpenArray(winStart, hi - 1), slope0)
    if beta[1] <= 0: continue            # degenerate fit (HR must raise speed)
    var deltas: seq[float]
    var actPace, expPace, wt = 0.0
    for i in mine:
      let p = beta.predict(segs[i])
      if p <= 0.5: continue
      deltas.add 1000 / segs[i].speed - 1000 / p
      actPace += segs[i].weight * 1000 / segs[i].speed
      expPace += segs[i].weight * 1000 / p
      wt += segs[i].weight
    if deltas.len == 0 or wt <= 0: continue
    var tsum, tn = 0.0
    for i in winStart ..< hi:
      if not segs[i].temp.isNaN: tsum += segs[i].temp; tn += 1
    let score = median(deltas)
    allScores.add abs(score)
    db.insertRow("run_model", @[
      ("activity_id", %act), ("delta", %score), ("n_seg", %mine.len),
      ("window_n", %used), ("window_days", %days),
      ("actual_pace", %(actPace / wt)), ("expected_pace", %(expPace / wt)),
      ("ref_pace", %(1000 / (beta[0] + beta[1] * RefHr + beta[2] * 0.5))),
      ("window_temp", (if tn > 0: %(tsum / tn) else: newJNull())),
      ("coef", %beta),
    ])
  db.exec(sql"COMMIT")
  # typical run-to-run scatter, for the UI's "is this noteworthy" band
  var noise = median(allScores)
  db.exec(sql"INSERT OR REPLACE INTO meta(key, value) VALUES ('run_model_noise', ?)",
          (if noise.isNaN: "" else: $noise))

# ── repeated routes ──────────────────────────────────────────────────────────
## Greedy, chronological clustering of route signatures: an activity joins the
## first existing route (same sport family) whose reference track — the
## route's earliest activity — has a GPS length within 10 %, start and end
## within 300 m, and a mean point-to-point distance (64 points equally spaced
## by distance) under 100 m with the 90th percentile under 250 m. Otherwise it
## starts a new route. Route ids are the reference activity's id, so they stay
## stable as new activities arrive (names in settings can key on them).
## Reverse direction is a different route (climbs land elsewhere).

const
  RouteLenTol = 0.10
  RouteEndTol = 300.0
  RouteMeanTol = 100.0
  RouteP90Tol = 250.0

type RouteSig = object
  id: int
  family: string
  length: float
  pts: seq[(float, float)]

proc fastDist(a, b: (float, float)): float =
  ## equirectangular approximation, fine for < 1 km comparisons
  let x = (b[1] - a[1]).degToRad * cos(((a[0] + b[0]) / 2).degToRad)
  let y = (b[0] - a[0]).degToRad
  6371000.0 * sqrt(x * x + y * y)

proc routeMatch(a, b: RouteSig): float =
  ## mean distance (m) if `a` matches route reference `b`, else NaN
  if a.family != b.family: return NaN
  if abs(a.length - b.length) > RouteLenTol * max(a.length, b.length): return NaN
  if fastDist(a.pts[0], b.pts[0]) > RouteEndTol or fastDist(a.pts[^1], b.pts[^1]) > RouteEndTol:
    return NaN
  var ds = newSeq[float](a.pts.len)
  var sum = 0.0
  for i in 0 ..< a.pts.len:
    ds[i] = fastDist(a.pts[i], b.pts[i]); sum += ds[i]
  let mean = sum / ds.len.float
  if mean > RouteMeanTol: return NaN
  ds.sort()
  if ds[int(0.9 * ds.high.float)] > RouteP90Tol: return NaN
  mean

proc computeRoutes*(db: DbConn) =
  var sigs: seq[RouteSig]
  for r in db.rows(sql"""SELECT s.activity_id, s.family, s.gps_length, s.pts
      FROM route_sig s JOIN activities a ON a.id = s.activity_id ORDER BY a.start_local"""):
    var pts: seq[(float, float)]
    for p in parseJson(r[3]): pts.add (p[0].getFloat, p[1].getFloat)
    sigs.add RouteSig(id: parseInt(r[0]), family: r[1], length: parseFloat(r[2]), pts: pts)
  var refs: seq[int]                       # indices into sigs of route references
  var assign = newSeq[(int, float)](sigs.len)
  for i, s in sigs:
    var best = -1
    var bestM = Inf
    for ri in refs:
      let m = routeMatch(s, sigs[ri])
      if not m.isNaN and m < bestM: best = ri; bestM = m
    if best < 0:
      refs.add i
      assign[i] = (s.id, 0.0)
    else:
      assign[i] = (sigs[best].id, bestM)
  db.exec(sql"BEGIN")
  db.exec(sql"DELETE FROM routes")
  for i, s in sigs:
    db.insertRow("routes", @[("activity_id", %s.id), ("route_id", %assign[i][0]),
                             ("match_m", %assign[i][1])])
  db.exec(sql"COMMIT")
