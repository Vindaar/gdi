## gdi_import — raw Garmin JSON → SQLite.
##
## Activity composites (`exercise-history.raw/<id>.json`, written by
## `garmin sync-raw` / `garmin export-org`) and daily health dumps
## (`garmin-health/raw/YYYY-MM-DD.json`). Files are tracked by (mtime, size)
## in the `files` table, so `scanAndImport` only touches what changed.

import std / [os, json, math, strutils, strformat, times, tables, algorithm, sets, sequtils]
import gdi_db, gdi_models, gdi_metrics

const
  ImporterVersion* = "14"
    ## Bump whenever derived data changes; forces a full re-import.
  BestEffortDistances* = [400.0, 1000.0, 1609.344, 3000.0, 5000.0, 10000.0,
                          15000.0, 20000.0, 21097.5, 30000.0, 40000.0, 42195.0,
                          50000.0, 100000.0, 160934.4, 200000.0]
  SpeedBucket* = 0.05        ## m/s per speed_hist bucket
  MaxGapS = 10.0             ## a sample "covers" at most this long without moving-time info
  DroppedStreams = ["directTimestamp", "sumDuration", "sumElapsedDuration",
                    "sumAccumulatedPower", "directRunCadence",
                    "directFractionalCadence"]

# ── small JSON helpers ──────────────────────────────────────────────────────

proc num(n: JsonNode, keys: varargs[string]): float =
  ## Numeric field (nested via `keys`) or NaN.
  var x = n
  for k in keys:
    if x.isNil or x.kind != JObject: return NaN
    x = x.getOrDefault(k)
  if x.isNil: return NaN
  case x.kind
  of JInt: float(x.getBiggestInt)
  of JFloat: x.getFloat
  else: NaN

proc str(n: JsonNode, keys: varargs[string]): string =
  var x = n
  for k in keys:
    if x.isNil or x.kind != JObject: return ""
    x = x.getOrDefault(k)
  if x.isNil or x.kind != JString: "" else: x.getStr

proc jf(x: float): JsonNode = (if x.isNaN: newJNull() else: %x)
proc js(s: string): JsonNode = (if s.len == 0: newJNull() else: %s)

proc fToC(f: float): float = (if f.isNaN: NaN else: (f - 32.0) * 5.0 / 9.0)
proc mphToMs(v: float): float = (if v.isNaN: NaN else: v * 0.44704)

proc parentType*(typeKey: string): string =
  ## Coarse family for filtering ("running" covers trail / treadmill / track).
  let k = typeKey
  if k.startsWith("moto"): "other"                # motorcycling_v2 contains "cycling"
  elif "running" in k: "running"
  elif "cycling" in k or "biking" in k or k == "e_bike_mountain": "cycling"
  elif "swimming" in k: "swimming"
  elif k in ["walking", "hiking", "casual_walking", "speed_walking"]: "walking"
  elif "climbing" in k or k == "bouldering": "climbing"
  elif k in ["strength_training", "hiit", "indoor_cardio", "yoga", "pilates",
             "breathwork"]: "fitness"
  else: "other"

# ── streams ─────────────────────────────────────────────────────────────────

type Streams* = OrderedTable[string, seq[float]]

proc parseDetails(det: JsonNode): Streams =
  ## Column-major float streams from `/details`; adds `t` (s since start).
  result = initOrderedTable[string, seq[float]]()
  if det.isNil or det.kind != JObject: return
  let rows = det.getOrDefault("activityDetailMetrics")
  let descs = det.getOrDefault("metricDescriptors")
  if rows.isNil or descs.isNil or rows.len == 0: return
  var idx: seq[(int, string)]
  for d in descs:
    idx.add (d["metricsIndex"].getInt, d["key"].getStr)
  var cols = initTable[string, seq[float]]()
  for (_, k) in idx: cols[k] = newSeq[float](rows.len)
  for r, row in rows.getElems:
    let m = row["metrics"]
    for (i, k) in idx:
      cols[k][r] = (if i < m.len: m[i].num() else: NaN)
  # Sort rows by timestamp (Garmin delivers them ordered, but be safe).
  if "directTimestamp" notin cols: return
  let ts = cols["directTimestamp"]
  var order = newSeq[int](ts.len)
  for i in 0 ..< order.len: order[i] = i
  order.sort(proc (a, b: int): int = cmp(ts[a], ts[b]))
  var t0 = NaN
  for x in ts:
    if not x.isNaN: t0 = (if t0.isNaN: x else: min(t0, x))
  var t = newSeq[float](ts.len)
  for j, i in order: t[j] = (ts[i] - t0) / 1000.0
  result["t"] = t
  var keys: seq[string]
  for (_, k) in idx: keys.add k
  keys.sort()
  for k in keys:
    var c = newSeq[float](order.len)
    for j, i in order: c[j] = cols[k][i]
    result[k] = c

proc streamsFromPolyline(pl: JsonNode): Streams =
  ## Fallback for dumps without `/details`: [[ts_ms, lat, lon], …].
  result = initOrderedTable[string, seq[float]]()
  let pts = pl{"polyline"}
  if pts.isNil or pts.kind != JArray or pts.len == 0: return
  var t, lat, lon: seq[float]
  let t0 = pts[0][0].num()
  for p in pts:
    t.add (p[0].num() - t0) / 1000.0
    lat.add p[1].num()
    lon.add p[2].num()
  result["t"] = t
  result["directLatitude"] = lat
  result["directLongitude"] = lon

proc get(s: Streams, k: string): seq[float] =
  if k in s: s[k] else: @[]

proc weights(s: Streams): seq[float] =
  ## Seconds of *moving* time each sample stands for (sample i covers i → i+1).
  let t = s.get("t")
  let mv = s.get("sumMovingDuration")
  result = newSeq[float](t.len)
  for i in 0 ..< t.len - 1:
    var w = NaN
    if mv.len == t.len and not mv[i].isNaN and not mv[i+1].isNaN:
      w = mv[i+1] - mv[i]
    if w.isNaN:
      w = t[i+1] - t[i]
      if w > MaxGapS: w = 0.0        # pause / gap without moving info
    result[i] = max(0.0, w)

proc forwardFilled(xs: seq[float]): seq[float] =
  result = xs
  var last = NaN
  for i in 0 ..< result.len:
    if result[i].isNaN: result[i] = last
    else: last = result[i]
  # leading NaNs → first value
  var first = NaN
  for x in result:
    if not x.isNaN: first = x; break
  for i in 0 ..< result.len:
    if result[i].isNaN: result[i] = first else: break

proc maxPlausibleSpeed*(family: string): float =
  ## Fastest sample speed (m/s) we believe for a sport; anything above is a
  ## GPS or recording glitch. Generous on purpose: running 10 m/s (own
  ## sprints peak at 8.4 m/s).
  case family
  of "running": 10.0
  of "walking": 5.0
  of "cycling": 30.0
  else: 30.0

proc strideGlitches*(family: string, speed, cad: seq[float]): seq[bool] =
  ## Running samples whose implied stride (speed / steps per second) is above
  ## 2.6 m: no real step, typically a GPS jump at the start.
  result = newSeq[bool](speed.len)
  if family == "running" and cad.len == speed.len:
    for i in 0 ..< speed.len:
      if not speed[i].isNaN and not cad[i].isNaN and cad[i] > 60:
        result[i] = speed[i] / (cad[i] / 60) > 2.6

type CleanDistance* = object
  cum*: seq[float]          ## cleaned cumulative distance from 0 (m), same length as t
  jumps*: int               ## distance steps replaced as implausible
  removed*: float           ## m dropped by those replacements
  ok*: bool                 ## false if the stream can't be used at all

proc cleanDistance*(t, distRaw, speed: seq[float], bad: seq[bool],
                    family: string, window = 5.0): CleanDistance =
  ## Cumulative distance with recording glitches removed. Per-second distance
  ## is lumpy (0 m, then 6 m), so steps aren't judged alone: an allowance of
  ## (1.5 × the watch's own speed + 1 m/s) · dt — capped at
  ## `maxPlausibleSpeed`; that cap alone where there is no (or a zero) speed
  ## reading and 1 m/s where a reading is itself implausible — accrues over at most
  ## `window` seconds,
  ## and only distance beyond it is dropped. Samples flagged in `bad` add
  ## nothing.
  let n = t.len
  if n < 2 or distRaw.len != n: return
  let d = forwardFilled(distRaw)
  if d[0].isNaN: return
  let cap = maxPlausibleSpeed(family)
  result.cum = newSeq[float](n)
  result.ok = true
  var avail = 0.0
  for i in 1 ..< n:
    let dt = t[i] - t[i-1]
    var step = max(0.0, d[i] - d[i-1])
    if dt <= 0 or (bad.len == n and (bad[i] or bad[i-1])):
      result.removed += step
      step = 0
    else:
      var rate = cap
      if speed.len == n:
        let refS = max(if speed[i].isNaN: 0.0 else: speed[i],
                       if speed[i-1].isNaN: 0.0 else: speed[i-1])
        # an implausible speed reading is a glitch itself: allow walking pace.
        # A zero reading while distance grows is a stale speed stream (seen
        # for minutes in Garmin walks), so only the cap applies there.
        rate = (if refS > cap: 1.0
                elif refS < 0.2: cap
                else: min(cap, 1.5 * refS + 1.0))
      avail = min(min(avail + rate * dt, rate * max(window, dt)), cap * dt)
      if step > avail:
        result.removed += step - avail
        step = avail
        inc result.jumps
      avail -= step
    result.cum[i] = result.cum[i-1] + step

proc hrCadenceLock*(hr, cad, t: seq[float], minRun = 120.0): float =
  ## Seconds in stretches of at least `minRun` s where heart rate sits within
  ## 3 bpm of the step rate — the classic optical-HR "cadence lock".
  if hr.len != t.len or cad.len != t.len: return 0
  var runStart = -1.0
  var last = 0.0
  for i in 0 ..< t.len:
    let locked = not hr[i].isNaN and not cad[i].isNaN and cad[i] > 130 and
                 abs(hr[i] - cad[i]) <= 3
    if locked:
      if runStart < 0: runStart = t[i]
      last = t[i]
    elif runStart >= 0 and (i == 0 or t[i] - last > 10):
      if last - runStart >= minRun: result += last - runStart
      runStart = -1
  if runStart >= 0 and last - runStart >= minRun: result += last - runStart

type BestEffort* = object
  distance*, time*, startT*, startDist*, avgHr*, elevGain*: float

proc bestEfforts*(t, distRaw, hr, elev: seq[float],
                  distances: openArray[float], minSamples = 8): seq[BestEffort] =
  ## Fastest elapsed time for each target distance, via two pointers over
  ## the cumulative distance with linear interpolation of the end point.
  ## Windows spanning fewer than `minSamples` samples are skipped: in sparse
  ## old recordings (a point every 10–60 s) they hinge on single readings.
  let n = t.len
  if n < 2 or distRaw.len != n: return
  var dist = forwardFilled(distRaw)
  if dist[0].isNaN: return
  for i in 1 ..< n: dist[i] = max(dist[i], dist[i-1])   # enforce monotonic
  # prefix sums for window averages
  var hrW = newSeq[float](n)     # Σ hr·dt
  var hrT = newSeq[float](n)     # Σ dt where hr known
  var gain = newSeq[float](n)    # Σ positive elevation deltas
  let el = forwardFilled(elev)
  for i in 1 ..< n:
    let dt = t[i] - t[i-1]
    hrW[i] = hrW[i-1]; hrT[i] = hrT[i-1]
    if hr.len == n and not hr[i-1].isNaN:
      hrW[i] += hr[i-1] * dt; hrT[i] += dt
    gain[i] = gain[i-1]
    if el.len == n and not el[i].isNaN and not el[i-1].isNaN:
      gain[i] += max(0.0, el[i] - el[i-1])
  let total = dist[^1] - dist[0]
  for D in distances:
    if D > total: continue
    var best = BestEffort(time: Inf)
    var j = 0
    for i in 0 ..< n:
      let target = dist[i] + D
      if j < i: j = i
      while j < n and dist[j] < target: inc j
      if j >= n: break
      # interpolate time at `target` between j-1 and j
      var tEnd = t[j]
      if j > 0 and dist[j] > dist[j-1]:
        let f = (target - dist[j-1]) / (dist[j] - dist[j-1])
        tEnd = t[j-1] + f * (t[j] - t[j-1])
      let dtime = tEnd - t[i]
      if dtime > 0 and dtime < best.time and j - i >= minSamples:
        let ht = hrT[j] - hrT[i]
        best = BestEffort(distance: D, time: dtime, startT: t[i],
                          startDist: dist[i] - dist[0],
                          avgHr: (if ht > 0: (hrW[j] - hrW[i]) / ht else: NaN),
                          elevGain: gain[j] - gain[i])
    if best.time < Inf:
      result.add best

proc weightedMean(xs, w: seq[float]): float =
  var s, ws = 0.0
  for i in 0 ..< min(xs.len, w.len):
    if not xs[i].isNaN and w[i] > 0:
      s += xs[i] * w[i]; ws += w[i]
  if ws > 0: s / ws else: NaN


type Segment* = object
  idx*: int
  startDist*, length*, time*, startT*: float
  avgSpeed*, avgGap*, avgHr*, avgCadence*, avgPower*, ascent*, descent*, grade*: float

proc segments*(st: Streams, wts: seq[float], segLen: float): seq[Segment] =
  ## Consecutive `segLen` metre chunks (last partial chunk dropped). Averages
  ## are moving-time weighted; `time` is moving time.
  let t = st.get("t")
  let n = t.len
  let dRaw = st.get("sumDistance")
  if n < 2 or dRaw.len != n: return
  var d = forwardFilled(dRaw)
  if d[0].isNaN: return
  for i in 1 ..< n: d[i] = max(d[i], d[i-1])
  let el = forwardFilled(st.get("directElevation"))
  let chans = [st.get("directGradeAdjustedSpeed"), st.get("directHeartRate"),
               st.get("directDoubleCadence"), st.get("directPower")]
  var cur = Segment(idx: 0, startDist: d[0], startT: t[0])
  var sums: array[4, float]
  var ws: array[4, float]
  var moving = 0.0
  var startEl = (if el.len == n: el[0] else: NaN)
  for i in 0 ..< n - 1:
    let w = wts[i]
    moving += w
    for c in 0 ..< 4:
      if chans[c].len == n and not chans[c][i].isNaN and w > 0:
        sums[c] += chans[c][i] * w; ws[c] += w
    if el.len == n and not el[i].isNaN and not el[i+1].isNaN:
      let dz = el[i+1] - el[i]
      if dz > 0: cur.ascent += dz else: cur.descent -= dz
    if d[i+1] - cur.startDist >= segLen:
      cur.length = d[i+1] - cur.startDist
      cur.time = moving
      cur.avgSpeed = (if moving > 0: cur.length / moving else: NaN)
      template avg(c: int): float = (if ws[c] > 0: sums[c] / ws[c] else: NaN)
      cur.avgGap = avg(0); cur.avgHr = avg(1)
      cur.avgCadence = avg(2); cur.avgPower = avg(3)
      cur.grade = (if el.len == n and not startEl.isNaN and not el[i+1].isNaN:
                     (el[i+1] - startEl) / cur.length * 100 else: NaN)
      if moving > 0: result.add cur
      cur = Segment(idx: cur.idx + 1, startDist: d[i+1], startT: t[i+1])
      sums = default(array[4, float]); ws = default(array[4, float])
      moving = 0.0
      startEl = (if el.len == n: el[i+1] else: NaN)

# ── estimated grade-adjusted pace ───────────────────────────────────────────
# Garmin only records GAP on newer watches. For older runs we estimate it with
# Garmin's own grade → effort curve, measured from 224 runs that have both
# (median of GAP/speed per 1 % grade bin, grade over ±60 m of distance).
# On held-out runs the activity-average GAP is within ~2.4 s/km of Garmin's.
# Note how much flatter this is than Minetti (2002), esp. downhill (floor 0.90).

const
  GapGradeMin = -0.30
  GapGradeStep = 0.01
  GapWindow = 60.0           ## m either side for the grade
  GapFactors = [
    0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959,
    0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959, 0.8959,
    0.9001, 0.9009, 0.9016, 0.9027, 0.9109, 0.9213, 0.9239, 0.9319, 0.9443,
    0.9589, 0.9702, 0.9850, 1.0000, 1.0177, 1.0393, 1.0603, 1.0884, 1.1203,
    1.1459, 1.1813, 1.2219, 1.2356, 1.2957, 1.3430, 1.3451, 1.4653, 1.4763,
    1.5045, 1.5298, 1.5730, 1.5999, 1.6268, 1.6537, 1.6807, 1.7076, 1.7345,
    1.7614, 1.7883, 1.8152, 1.8422, 1.8691, 1.8960, 1.9229]

proc gapFactor*(grade: float): float =
  ## Flat-equivalent speed / actual speed at `grade` (fraction), interpolated.
  let x = (clamp(grade, GapGradeMin, -GapGradeMin) - GapGradeMin) / GapGradeStep
  let i = min(int(x), GapFactors.high - 1)
  let f = x - float(i)
  GapFactors[i] * (1 - f) + GapFactors[i + 1] * f

proc gradeStream*(distRaw, elevRaw: seq[float], window = GapWindow): seq[float] =
  ## Centred grade over ±`window` metres: elevation interpolated on distance.
  let n = distRaw.len
  result = newSeq[float](n)
  var d = forwardFilled(distRaw)
  let e = forwardFilled(elevRaw)
  if n == 0 or d[0].isNaN or e[0].isNaN: return
  for i in 1 ..< n: d[i] = max(d[i], d[i-1])
  proc elevAt(x: float): float =
    if x <= d[0]: return e[0]
    if x >= d[^1]: return e[^1]
    let j = lowerBound(d, x)                    # first d[j] >= x, j ≥ 1
    let span = d[j] - d[j-1]
    if span <= 0: e[j] else: e[j-1] + (x - d[j-1]) / span * (e[j] - e[j-1])
  for i in 0 ..< n:
    result[i] = (elevAt(d[i] + window) - elevAt(d[i] - window)) / (2 * window)

proc estimateGap(st: var Streams): bool =
  ## Adds `directGradeAdjustedSpeed` from speed + elevation; false if impossible.
  let sp = st.get("directSpeed")
  let d = st.get("sumDistance")
  let el = st.get("directElevation")
  if sp.len == 0 or d.len != sp.len or el.len != sp.len: return false
  var anyElev = false
  for x in el:
    if not x.isNaN: anyElev = true; break
  if not anyElev: return false
  let g = gradeStream(d, el)
  var gap = newSeq[float](sp.len)
  for i in 0 ..< sp.len:
    gap[i] = (if sp[i].isNaN or g[i].isNaN: NaN else: sp[i] * gapFactor(g[i]))
  st["directGradeAdjustedSpeed"] = gap
  true

# ── mean-maximal values by duration ─────────────────────────────────────────

const MmpDurations* = [10, 20, 30, 60, 120, 180, 240, 300, 420, 600, 900, 1200,
                       1800, 2700, 3600, 5400, 7200, 10800]

proc cumulative(t, rate: seq[float]): seq[float] =
  ## ∫ rate dt (trapezoid-free: sample i's value holds until i+1; gaps > 10 s
  ## contribute nothing, i.e. paused time counts as zero output).
  result = newSeq[float](t.len)
  for i in 1 ..< t.len:
    let dt = t[i] - t[i-1]
    let r = rate[i-1]
    result[i] = result[i-1] + (if r.isNaN or dt <= 0 or dt > MaxGapS: 0.0 else: r * dt)

proc median5(xs: seq[float]): seq[float] =
  ## 5-sample running median: removes single-sample spikes, keeps real efforts.
  result = xs
  for i in 2 ..< xs.len - 2:
    var w: seq[float]
    for k in i - 2 .. i + 2:
      if not xs[k].isNaN: w.add xs[k]
    if w.len >= 3:
      w.sort()
      result[i] = w[w.len div 2]

proc meanMax*(t, cum: seq[float], durations: openArray[int]): seq[(int, float, float)] =
  ## Best average rate over each duration: max over windows [t_i, t_i + D] of
  ## (cum(t_i + D) − cum(t_i)) / D, end point linearly interpolated.
  ## Windows need min(8, D/2) samples, so sparse recordings don't produce
  ## short-duration bests from one or two readings.
  ## Returns (duration, value, start_t).
  let n = t.len
  if n < 2: return
  let total = t[^1] - t[0]
  for D in durations:
    let d = float(D)
    if d > total: continue
    var best = -1.0
    var bestStart = 0.0
    var j = 0
    for i in 0 ..< n:
      let target = t[i] + d
      if j < i: j = i
      while j < n and t[j] < target: inc j
      if j >= n: break
      var c = cum[j]
      if j > 0 and t[j] > t[j-1]:
        let f = (target - t[j-1]) / (t[j] - t[j-1])
        c = cum[j-1] + f * (cum[j] - cum[j-1])
      if j - i < min(8, D div 2): continue
      let v = (c - cum[i]) / d
      if v > best: best = v; bestStart = t[i]
    if best > 0: result.add (D, best, bestStart)

# ── heart-rate recovery ─────────────────────────────────────────────────────
# Where a hard stretch clearly ends (mean speed over the previous 60 s ≥ 1.15 ×
# the activity's median moving speed, and the next 60 s at most 0.7 × that),
# take the peak HR around the end and the drop 60 / 120 s after the peak.
# Grade-adjusted speed where available, so hill repeats count by effort.
# Running only: on a bike (without power) a slowdown is mostly a descent.

type HrRecovery* = object
  tEnd*, effortSecs*, effortSpeed*, postSpeed*, peakHr*, tPeak*, drop60*, drop120*: float

proc hrRecovery*(t, cum, hr: seq[float]): seq[HrRecovery] =
  ## `cum`: cumulative (grade-adjusted) distance. Needs gap-free samples
  ## around each point (auto-pause leaves holes → that point is skipped).
  let n = t.len
  if n < 300 or cum.len != n or hr.len != n: return
  proc idxAt(x: float): int =
    ## last sample with t ≤ x (binary search)
    var lo = 0
    var hi = n - 1
    if x < t[0]: return -1
    while lo < hi:
      let mid = (lo + hi + 1) div 2
      if t[mid] <= x: lo = mid else: hi = mid - 1
    lo
  proc cumAt(x: float): float =
    let i = idxAt(x)
    if i < 0: return cum[0]
    if i >= n - 1: return cum[^1]
    let f = (x - t[i]) / max(1e-9, t[i+1] - t[i])
    cum[i] + f * (cum[i+1] - cum[i])
  proc meanSpeed(a, b: float): float = (cumAt(b) - cumAt(a)) / (b - a)
  proc hrAt(x: float): float =
    ## HR at time x from a sample within 3 s, else NaN
    let i = idxAt(x)
    var best = NaN
    var bd = 3.01
    for k in [i, i + 1]:
      if k >= 0 and k < n and abs(t[k] - x) < bd and not hr[k].isNaN and hr[k] > 0:
        bd = abs(t[k] - x); best = hr[k]
    best
  proc continuous(a, b: float): bool =
    ## no recording hole longer than 5 s in [a, b]
    let i0 = max(0, idxAt(a))
    let i1 = idxAt(b)
    if i1 < 0 or t[min(n - 1, i1 + 1)] < b - 5: return false
    for k in i0 + 1 .. min(n - 1, i1 + 1):
      if t[k] - t[k-1] > 5: return false
    true
  # median moving speed (1-s resolution not assumed: weight by dt)
  var sp: seq[float]
  for i in 1 ..< n:
    let dt = t[i] - t[i-1]
    if dt > 0 and dt <= 5:
      let v = (cum[i] - cum[i-1]) / dt
      if v > 0.5: sp.add v
  if sp.len < 100: return
  sp.sort()
  let med = sp[sp.len div 2]
  var i = 0
  var nextAllowed = t[0] + 60
  while i < n:
    let te = t[i]
    if te < nextAllowed or te + 125 > t[^1]: inc i; continue
    let before = meanSpeed(te - 60, te)
    let after = meanSpeed(te + 5, te + 65)
    if before >= 1.15 * med and after <= 0.7 * before:
      # the sharpest slowdown within the next 20 s is the end of the effort
      var bestT = te
      var bestDrop = before - after
      var k = i + 1
      while k < n and t[k] <= te + 20:
        let d = meanSpeed(t[k] - 60, t[k]) - meanSpeed(t[k] + 5, t[k] + 65)
        if d > bestDrop: bestDrop = d; bestT = t[k]
        inc k
      # peak HR lags the effort: look 10 s before to 20 s after its end
      var peak = NaN
      var tp = NaN
      for j in max(0, idxAt(bestT - 10)) .. min(n - 1, idxAt(bestT + 20)):
        if not hr[j].isNaN and (peak.isNaN or hr[j] > peak): peak = hr[j]; tp = t[j]
      if not peak.isNaN and continuous(bestT - 60, tp + 60):
        let h60 = hrAt(tp + 60)
        var r = HrRecovery(tEnd: bestT, effortSpeed: meanSpeed(bestT - 60, bestT),
                           postSpeed: meanSpeed(tp, tp + 60), peakHr: peak, tPeak: tp,
                           drop60: peak - h60, drop120: NaN)
        # the second minute only counts if no new effort started in it
        if tp + 120 <= t[^1] and continuous(tp + 60, tp + 120) and
           meanSpeed(tp + 60, tp + 120) <= 0.75 * r.effortSpeed:
          r.drop120 = peak - hrAt(tp + 120)
        # effort duration: back from the end while 30-s speed stays elevated
        var s0 = bestT - 30
        while s0 - 30 >= t[0] and bestT - s0 < 3600 and meanSpeed(s0 - 30, s0) >= 1.15 * med: s0 -= 10
        r.effortSecs = bestT - s0
        if not r.drop60.isNaN: result.add r
        nextAllowed = tp + 120
      else:
        nextAllowed = bestT + 30
      i = idxAt(nextAllowed) + 1
      continue
    inc i

# ── aerobic decoupling (Pa:HR) ──────────────────────────────────────────────
# Efficiency = output ÷ HR (output = grade-adjusted speed for runs, power for
# rides with a power meter). After a 10 min warm-up, the remaining moving time
# is split in halves; decoupling = (EF₁ − EF₂) / EF₁ in %. Only meaningful for
# steady efforts: `steady` requires ≥ 30 min after warm-up and a coefficient of
# variation of 1-min output averages ≤ 12 %.

const
  DecouplingWarmup = 600.0
  DecouplingMinAnalysed = 1800.0
  SteadyMaxCv = 0.12

proc decoupling(output, hr, w: seq[float]): (float, bool, float) =
  ## (decoupling %, steady, cv); NaN when not computable.
  result = (NaN, false, NaN)
  let n = min(output.len, min(hr.len, w.len))
  if n < 10: return
  var total = 0.0
  for i in 0 ..< n: total += w[i]
  let analysed = total - DecouplingWarmup
  if analysed < DecouplingMinAnalysed: return
  let mid = DecouplingWarmup + analysed / 2
  var acc = 0.0
  var o1, h1, o2, h2 = 0.0
  # 1-min buckets for variability
  var bucketO, bucketW = 0.0
  var minutes: seq[float]
  for i in 0 ..< n:
    let wi = w[i]
    let at = acc
    acc += wi
    if at < DecouplingWarmup or wi <= 0 or output[i].isNaN or hr[i].isNaN or hr[i] <= 0: continue
    if at < mid:
      o1 += output[i] * wi; h1 += hr[i] * wi
    else:
      o2 += output[i] * wi; h2 += hr[i] * wi
    bucketO += output[i] * wi; bucketW += wi
    if bucketW >= 60:
      minutes.add bucketO / bucketW
      bucketO = 0; bucketW = 0
  if h1 <= 0 or h2 <= 0 or o1 <= 0 or o2 <= 0 or minutes.len < 10: return
  let ef1 = o1 / h1
  let ef2 = o2 / h2
  var mean = 0.0
  for m in minutes: mean += m
  mean /= minutes.len.float
  var v = 0.0
  for m in minutes: v += (m - mean) ^ 2
  let cv = sqrt(v / minutes.len.float) / mean
  result = ((ef1 - ef2) / ef1 * 100, cv <= SteadyMaxCv, cv)

# ── route signature ─────────────────────────────────────────────────────────

const RouteSigPoints* = 64

proc haversine*(lat1, lon1, lat2, lon2: float): float =
  const R = 6371000.0
  let p1 = lat1.degToRad; let p2 = lat2.degToRad
  let dp = (lat2 - lat1).degToRad; let dl = (lon2 - lon1).degToRad
  let a = sin(dp / 2) ^ 2 + cos(p1) * cos(p2) * sin(dl / 2) ^ 2
  2 * R * arcsin(sqrt(min(1.0, a)))

proc routeSignature*(lat, lon: seq[float]): (float, seq[(float, float)]) =
  ## GPS track resampled to `RouteSigPoints` points equally spaced by
  ## (GPS) distance; returns (track length m, points). Empty if no track.
  var pts: seq[(float, float)]
  for i in 0 ..< min(lat.len, lon.len):
    if lat[i].isNaN or lon[i].isNaN or (lat[i] == 0 and lon[i] == 0): continue
    pts.add (lat[i], lon[i])
  if pts.len < 10: return
  var cum = newSeq[float](pts.len)
  for i in 1 ..< pts.len:
    var d = haversine(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1])
    if d > 500: d = 0                    # GPS jump / paused gap: don't count
    cum[i] = cum[i-1] + d
  let total = cum[^1]
  if total < 500: return
  var res: seq[(float, float)]
  var j = 0
  for k in 0 ..< RouteSigPoints:
    let target = total * k.float / (RouteSigPoints - 1).float
    while j < cum.high and cum[j + 1] < target: inc j
    if j >= cum.high:
      res.add pts[^1]
    else:
      let span = cum[j + 1] - cum[j]
      let f = (if span > 0: (target - cum[j]) / span else: 0.0)
      res.add (pts[j][0] + f * (pts[j + 1][0] - pts[j][0]), pts[j][1] + f * (pts[j + 1][1] - pts[j][1]))
  (total, res)

# ── activity import ─────────────────────────────────────────────────────────

proc deleteActivity*(db: DbConn, id: int) =
  for t in ["activities", "streams", "laps", "best_efforts", "hr_hist",
            "speed_hist", "segments", "mmp", "route_sig", "hr_recovery", "activity_gear"]:
    let col = if t == "activities": "id" else: "activity_id"
    db.exec(sql("DELETE FROM " & t & " WHERE " & col & " = ?"), id)

proc importActivity*(db: DbConn, j: JsonNode) =
  let id = j["activityId"].getInt
  let act = j["activity"]
  let s = act{"summaryDTO"}
  let typeKey = act.str("activityTypeDTO", "typeKey")
  let w = j{"weather"}
  db.deleteActivity(id)

  var st = parseDetails(j{"details"})
  if st.len == 0 or "t" notin st:
    st = streamsFromPolyline(j{"polyline"})
  if "directDoubleCadence" notin st and "directRunCadence" in st:
    # older dumps: one-foot cadence only → steps per minute
    st["directDoubleCadence"] = st["directRunCadence"].mapIt(it * 2)
  var gapSource = (if "directGradeAdjustedSpeed" in st: "garmin" else: "")
  if gapSource.len == 0 and parentType(typeKey) == "running" and st.estimateGap():
    gapSource = "estimated"
  let wts = st.weights()
  let decOut =
    if parentType(typeKey) == "running": st.get("directGradeAdjustedSpeed")
    elif parentType(typeKey) == "cycling": st.get("directPower")
    else: @[]
  let (decPct, decSteady, decCv) =
    if decOut.len > 0: decoupling(decOut, st.get("directHeartRate"), wts) else: (NaN, false, NaN)
  let nSamples = st.get("t").len
  let lat = st.get("directLatitude")
  var hasGps = false
  for x in lat:
    if not x.isNaN and x != 0: hasGps = true; break

  var gearName = ""
  if j{"gear"} != nil and j["gear"].kind == JArray:
    for g in j["gear"]:
      let nm = g.str("name")
      gearName = if nm.len > 0: nm else: g.str("brand") & " " & g.str("model")
      gearName = gearName.strip
      break

  let dist = s.num("distance")
  let gainM = s.num("elevationGain")
  # Average GAP on the same baseline as the summary pace: Garmin's own value
  # when present, else summary moving speed × (sample GAP / sample speed).
  var avgGap = s.num("avgGradeAdjustedSpeed")
  if avgGap.isNaN and "directGradeAdjustedSpeed" in st:
    let ratio = weightedMean(st.get("directGradeAdjustedSpeed"), wts) / weightedMean(st.get("directSpeed"), wts)
    let base = s.num("averageMovingSpeed")
    avgGap = (if not base.isNaN and base > 0 and not ratio.isNaN: base * ratio
              else: weightedMean(st.get("directGradeAdjustedSpeed"), wts))
  # data quality: glitch-cleaned distance plus flags for what looks wrong
  let family = parentType(typeKey)
  let bad = strideGlitches(family, st.get("directSpeed"), st.get("directDoubleCadence"))
  let clean = cleanDistance(st.get("t"), st.get("sumDistance"), st.get("directSpeed"), bad, family)
  var dq = newJObject()
  var distUsable = clean.ok
  if clean.ok:
    if clean.removed > max(50.0, 0.005 * clean.cum[^1]):
      dq["gps_jumps"] = %clean.jumps
      dq["removed_m"] = %round(clean.removed)
    let tot = clean.cum[^1]
    if not dist.isNaN and dist > 500 and tot > 1.25 * dist:
      # the stream claims far more distance than the summary even after
      # cleaning: don't trust it for records at all
      dq["distance_mismatch"] = %round(tot / dist, 2)
      distUsable = false
  block:
    let t = st.get("t")
    var badS = 0.0
    for i in 1 ..< min(bad.len, t.len):
      if bad[i]: badS += t[i] - t[i-1]
    if badS > 0: dq["stride_glitch_s"] = %round(badS)
    let spd = st.get("directSpeed")
    if spd.len == t.len:
      # watch-reported speed beyond the sport's limit: usually a mislabelled
      # activity (a train ride recorded as a walk) rather than a glitch
      var fastS = 0.0
      let cap = maxPlausibleSpeed(family)
      for i in 1 ..< t.len:
        if not spd[i].isNaN and spd[i] > cap: fastS += min(t[i] - t[i-1], MaxGapS)
      if fastS >= 30: dq["implausible_speed_s"] = %round(fastS)
    if t.len > 10:
      var dts: seq[float]
      for i in 1 ..< t.len: dts.add t[i] - t[i-1]
      dts.sort()
      let med = dts[dts.len div 2]
      if med > 5: dq["sparse_sampling_s"] = %round(med)
    let hrS = st.get("directHeartRate")
    if hrS.len == wts.len:
      var have, miss = 0.0
      for i in 0 ..< wts.len:
        if wts[i] <= 0: continue
        if hrS[i].isNaN or hrS[i] <= 0: miss += wts[i] else: have += wts[i]
      if have > 0 and miss / (have + miss) > 0.1:
        dq["hr_missing_pct"] = %round(100 * miss / (have + miss))
    let lockS = hrCadenceLock(hrS, st.get("directDoubleCadence"), t)
    if lockS > 0: dq["hr_cadence_lock_s"] = %round(lockS)
  var meta = newJObject()
  for k, v in j:
    if k notin ["details", "polyline"]: meta[k] = v

  db.insertRow("activities", @[
    ("id", %id),
    ("name", js act.str("activityName")),
    ("type_key", js typeKey),
    ("parent_type", %parentType(typeKey)),
    ("location", js act.str("locationName")),
    ("start_local", js s.str("startTimeLocal")),
    ("start_gmt", js s.str("startTimeGMT")),
    ("start_lat", jf s.num("startLatitude")),
    ("start_lon", jf s.num("startLongitude")),
    ("distance", jf dist),
    ("duration", jf s.num("duration")),
    ("moving_duration", jf s.num("movingDuration")),
    ("elapsed_duration", jf s.num("elapsedDuration")),
    ("elev_gain", jf gainM),
    ("elev_loss", jf s.num("elevationLoss")),
    ("min_elev", jf s.num("minElevation")),
    ("max_elev", jf s.num("maxElevation")),
    ("ascent_per_km", jf(if dist > 100 and not gainM.isNaN: gainM / (dist / 1000) else: NaN)),
    ("avg_speed", jf s.num("averageSpeed")),
    ("avg_moving_speed", jf s.num("averageMovingSpeed")),
    ("max_speed", jf s.num("maxSpeed")),
    ("avg_gap_speed", jf avgGap),
    ("gap_source", js gapSource),
    ("decoupling", jf decPct),
    ("decoupling_steady", (if decPct.isNaN: newJNull() else: %int(decSteady))),
    ("pace_cv", jf decCv),
    ("dq_flags", (if dq.len == 0: newJNull() else: %($dq))),
    ("avg_hr", jf s.num("averageHR")),
    ("max_hr", jf s.num("maxHR")),
    ("min_hr", jf s.num("minHR")),
    ("avg_cadence", jf(block:
      let c = s.num("averageRunCadence")
      if c.isNaN: s.num("averageBikeCadence") else: c)),
    ("max_cadence", jf(block:
      let c = s.num("maxRunCadence")
      if c.isNaN: s.num("maxBikeCadence") else: c)),
    ("avg_power", jf s.num("averagePower")),
    ("max_power", jf s.num("maxPower")),
    ("norm_power", jf s.num("normalizedPower")),
    ("avg_stride", jf s.num("strideLength")),
    ("calories", jf s.num("calories")),
    ("aerobic_te", jf s.num("trainingEffect")),
    ("anaerobic_te", jf s.num("anaerobicTrainingEffect")),
    ("training_load", jf s.num("activityTrainingLoad")),
    ("te_label", js s.str("trainingEffectLabel")),
    ("avg_temp", jf s.num("averageTemperature")),
    ("steps", jf s.num("steps")),
    ("w_temp", jf fToC(w.num("temp"))),
    ("w_apparent_temp", jf fToC(w.num("apparentTemp"))),
    ("w_dew_point", jf fToC(w.num("dewPoint"))),
    ("w_humidity", jf w.num("relativeHumidity")),
    ("w_wind_speed", jf mphToMs(w.num("windSpeed"))),
    ("w_wind_gust", jf mphToMs(w.num("windGust"))),
    ("w_wind_dir", js w.str("windDirectionCompassPoint")),
    ("w_type", js w.str("weatherTypeDTO", "desc")),
    ("gear", js gearName),
    ("n_samples", %nSamples),
    ("has_gps", %int(hasGps)),
    ("meta_json", meta),
  ])

  # gear (all items; `activities.gear` keeps the first for the list)
  if j{"gear"} != nil and j["gear"].kind == JArray:
    for g in j["gear"]:
      let nm = g.str("name")
      db.insertRow("activity_gear", @[("activity_id", %id), ("uuid", %g.str("uuid")),
        ("name", js(if nm.len > 0: nm else: (g.str("brand") & " " & g.str("model")).strip)),
        ("gear_type", js g.str("gearType")), ("json", %($g))])

  # streams
  for k, xs in st:
    if k in DroppedStreams: continue
    var any = false
    for x in xs:
      if not x.isNaN: any = true; break
    if any: db.putStream(id, k, xs)

  # laps
  let lapsN = j{"laps", "lapDTOs"}
  if lapsN != nil and lapsN.kind == JArray:
    for i, l in lapsN.getElems:
      db.insertRow("laps", @[
        ("activity_id", %id), ("idx", %i),
        ("start_gmt", js l.str("startTimeGMT")),
        ("distance", jf l.num("distance")),
        ("duration", jf l.num("duration")),
        ("moving_duration", jf l.num("movingDuration")),
        ("avg_speed", jf l.num("averageSpeed")),
        ("avg_hr", jf l.num("averageHR")),
        ("max_hr", jf l.num("maxHR")),
        ("avg_cadence", jf l.num("averageRunCadence")),
        ("avg_power", jf l.num("averagePower")),
        ("elev_gain", jf l.num("elevationGain")),
        ("elev_loss", jf l.num("elevationLoss")),
      ])

  # histograms (moving time)
  let hr = st.get("directHeartRate")
  if hr.len == wts.len:
    var h = initTable[int, float]()
    for i, x in hr:
      if not x.isNaN and x > 0 and wts[i] > 0:
        h.mgetOrPut(int(round(x)), 0.0) += wts[i]
    for bpm, secs in h:
      db.insertRow("hr_hist", @[("activity_id", %id), ("bpm", %bpm), ("secs", %secs)])
  let sp = st.get("directSpeed")
  let gap = st.get("directGradeAdjustedSpeed")
  if sp.len == wts.len:
    var h = initTable[int, (float, float)]()
    for i in 0 ..< wts.len:
      if wts[i] <= 0: continue
      if not sp[i].isNaN and sp[i] >= 0:
        h.mgetOrPut(int(round(sp[i] / SpeedBucket)), (0.0, 0.0))[0] += wts[i]
      if gap.len == wts.len and not gap[i].isNaN and gap[i] >= 0:
        h.mgetOrPut(int(round(gap[i] / SpeedBucket)), (0.0, 0.0))[1] += wts[i]
    for b, v in h:
      db.insertRow("speed_hist", @[("activity_id", %id), ("bucket", %b),
                                   ("secs", %v[0]), ("gap_secs", %v[1])])

  # route signature (for repeated-route detection, see gdi_models)
  if hasGps:
    let (glen, sig) = routeSignature(st.get("directLatitude"), st.get("directLongitude"))
    if sig.len == RouteSigPoints:
      var arr = newJArray()
      for (la, lo) in sig: arr.add %*[round(la, 6), round(lo, 6)]
      db.insertRow("route_sig", @[("activity_id", %id), ("family", %parentType(typeKey)),
                                  ("gps_length", %glen), ("pts", arr)])

  # 1 km segments
  for sg in segments(st, wts, 1000.0):
    db.insertRow("segments", @[
      ("activity_id", %id), ("idx", %sg.idx), ("start_dist", %(sg.startDist)),
      ("start_t", %sg.startT), ("length", %sg.length), ("time", %sg.time),
      ("avg_speed", jf sg.avgSpeed), ("avg_gap", jf sg.avgGap),
      ("avg_hr", jf sg.avgHr), ("avg_cadence", jf sg.avgCadence),
      ("avg_power", jf sg.avgPower), ("ascent", jf sg.ascent),
      ("descent", jf sg.descent), ("grade", jf sg.grade)])

  # mean-maximal speed (from cleaned distance), GAP speed and power by duration
  block:
    let t = st.get("t")
    var sources: seq[(string, seq[float])]
    proc masked(xs: seq[float]): seq[float] =
      result = xs
      for i in 0 ..< min(result.len, bad.len):
        if bad[i]: result[i] = NaN
    if distUsable: sources.add ("speed", clean.cum)
    let gapS = st.get("directGradeAdjustedSpeed")
    if gapS.len == t.len: sources.add ("gap", cumulative(t, median5(masked(gapS))))
    let pw = st.get("directPower")
    if pw.len == t.len: sources.add ("power", cumulative(t, median5(masked(pw))))
    for (metric, cum) in sources:
      for (D, v, s0) in meanMax(t, cum, MmpDurations):
        db.insertRow("mmp", @[("activity_id", %id), ("metric", %metric),
                              ("duration", %D), ("value", %v), ("start_t", %s0)])

  # heart-rate recovery after hard stretches (on GAP where available)
  if family == "running" and hr.len == st.get("t").len and distUsable:
    let t = st.get("t")
    let gapS = st.get("directGradeAdjustedSpeed")
    let cumE = (if gapS.len == t.len: cumulative(t, median5(gapS)) else: clean.cum)
    for r in hrRecovery(t, cumE, hr):
      db.insertRow("hr_recovery", @[("activity_id", %id), ("t_end", %r.tEnd),
        ("effort_secs", %r.effortSecs), ("effort_speed", jf r.effortSpeed),
        ("post_speed", jf r.postSpeed), ("peak_hr", %r.peakHr), ("t_peak", %r.tPeak),
        ("drop60", jf r.drop60), ("drop120", jf r.drop120)])

  # best efforts (on the cleaned distance)
  if distUsable:
    for be in bestEfforts(st.get("t"), clean.cum, hr, st.get("directElevation"),
                          BestEffortDistances):
      db.insertRow("best_efforts", @[
        ("activity_id", %id), ("distance", %be.distance), ("time", %be.time),
        ("start_t", %be.startT), ("start_dist", %be.startDist),
        ("avg_hr", jf be.avgHr), ("elev_gain", jf be.elevGain)])

# ── health import ───────────────────────────────────────────────────────────

proc importHealthDay*(db: DbConn, date: string, j: JsonNode) =
  let s = j{"summary"}
  let sl = j{"sleep", "dailySleepDTO"}
  let bc = j{"bodyComposition"}
  var weight = bc.num("totalAverage", "weight")
  var fat = bc.num("totalAverage", "bodyFat")
  if weight.isNaN and bc != nil and bc{"dateWeightList"} != nil:
    for e in bc["dateWeightList"]:
      weight = e.num("weight"); fat = e.num("bodyFat")
  db.insertRow("health_days", @[
    ("date", %date),
    ("steps", jf s.num("totalSteps")),
    ("distance", jf s.num("totalDistanceMeters")),
    ("total_kcal", jf s.num("totalKilocalories")),
    ("active_kcal", jf s.num("activeKilocalories")),
    ("resting_hr", jf s.num("restingHeartRate")),
    ("min_hr", jf s.num("minHeartRate")),
    ("max_hr", jf s.num("maxHeartRate")),
    ("avg_stress", jf(block:
      let v = s.num("averageStressLevel")
      if v < 0: NaN else: v)),
    ("max_stress", jf(block:
      let v = s.num("maxStressLevel")
      if v < 0: NaN else: v)),
    ("bb_high", jf s.num("bodyBatteryHighestValue")),
    ("bb_low", jf s.num("bodyBatteryLowestValue")),
    ("bb_charged", jf s.num("bodyBatteryChargedValue")),
    ("bb_drained", jf s.num("bodyBatteryDrainedValue")),
    ("bb_wake", jf s.num("bodyBatteryAtWakeTime")),
    ("sleep_secs", jf sl.num("sleepTimeSeconds")),
    ("deep_secs", jf sl.num("deepSleepSeconds")),
    ("light_secs", jf sl.num("lightSleepSeconds")),
    ("rem_secs", jf sl.num("remSleepSeconds")),
    ("awake_secs", jf sl.num("awakeSleepSeconds")),
    ("sleep_score", jf sl.num("sleepScores", "overall", "value")),
    ("sleep_avg_hr", jf sl.num("avgHeartRate")),
    ("sleep_avg_stress", jf sl.num("avgSleepStress")),
    ("sleep_resp", jf sl.num("averageRespirationValue")),
    ("waking_resp", jf s.num("avgWakingRespirationValue")),
    ("intensity_mod", jf s.num("moderateIntensityMinutes")),
    ("intensity_vig", jf s.num("vigorousIntensityMinutes")),
    ("floors_up", jf s.num("floorsAscended")),
    ("weight", jf(if weight.isNaN: NaN else: weight / 1000.0)),
    ("bed_time", jf(block:
      # local clock hour of falling asleep, continuous across midnight (22.5 = 22:30, 24.5 = 00:30)
      let ms = sl.num("sleepStartTimestampLocal")
      if ms.isNaN: NaN
      else:
        let hrs = (ms / 1000 mod 86400) / 3600
        if hrs < 12: hrs + 24 else: hrs)),
    ("wake_time", jf(block:
      let ms = sl.num("sleepEndTimestampLocal")
      if ms.isNaN: NaN else: (ms / 1000 mod 86400) / 3600)),
    ("body_fat", jf fat),
    ("json", j),
  ])

# ── directory scan ──────────────────────────────────────────────────────────

type
  LogProc* = proc (msg: string) {.gcsafe.}
  ImportStats* = object
    imported*, unchanged*, failed*, removed*: int

proc fileSig(path: string): (int64, int64) =
  let info = getFileInfo(path)
  (int64(info.lastWriteTime.toUnix), int64(info.size))

proc scanDir(db: DbConn, dir, kind: string, stats: var ImportStats,
             log: LogProc) =
  if dir.len == 0 or not dirExists(dir): return
  var known = initTable[string, (int64, int64)]()
  for r in db.rows(sql"SELECT path, mtime, size FROM files WHERE kind = ?", kind):
    known[r[0]] = (parseBiggestInt(r[1]).int64, parseBiggestInt(r[2]).int64)
  var seen = initHashSet[string]()
  var batch = 0
  db.exec(sql"BEGIN")
  var paths: seq[string]
  if kind == "metrics":
    for f in walkDirRec(dir):
      if f.endsWith(".json"): paths.add f
  else:
    for f in walkFiles(dir / "*.json"): paths.add f
  for path in paths:
    # canonical path (symlinks resolved): the same file must have the same
    # key however its directory was specified, or a scan with another spelling
    # would treat every known file as removed
    let p = try: expandFilename(path) except OSError: absolutePath(path)
    seen.incl p
    let sig = try: fileSig(p) except OSError: continue
    if known.getOrDefault(p, (-1'i64, -1'i64)) == sig:
      inc stats.unchanged
      continue
    var err = ""
    try:
      let j = parseFile(p)
      if kind == "activity":
        db.importActivity(j)
      elif kind == "metrics":
        db.importMetricFile(p)
      else:
        db.importHealthDay(p.extractFilename.changeFileExt(""), j)
      inc stats.imported
    except CatchableError as e:
      err = e.msg
      inc stats.failed
      log "import failed: " & p & ": " & e.msg
    db.insertRow("files", @[("path", %p), ("kind", %kind), ("mtime", %sig[0]),
                            ("size", %sig[1]), ("imported_at", %getTime().toUnix),
                            ("error", js err)])
    inc batch
    if batch mod 100 == 0:
      db.exec(sql"COMMIT")
      log &"{kind}: {stats.imported} imported…"
      db.exec(sql"BEGIN")
  # files that disappeared. A stale entry whose file name is still present
  # under another path (same activity id / date) only loses its record —
  # the data was just (re)imported from the current path.
  var seenNames = initHashSet[string]()
  for p in seen: seenNames.incl p.extractFilename
  for p in known.keys:
    if p notin seen and p.extractFilename in seenNames:
      db.exec(sql"DELETE FROM files WHERE path = ?", p)
      continue
    if p notin seen:
      if kind == "activity":
        let id = try: parseInt(p.extractFilename.changeFileExt("")) except ValueError: -1
        if id >= 0: db.deleteActivity(id)
      elif kind == "metrics":
        discard                       # rows are keyed by (date, metric); keep them
      else:
        db.exec(sql"DELETE FROM health_days WHERE date = ?",
                p.extractFilename.changeFileExt(""))
      db.exec(sql"DELETE FROM files WHERE path = ?", p)
      inc stats.removed
  db.exec(sql"COMMIT")

proc markDuplicates*(db: DbConn) =
  ## The same workout uploaded twice (2016/17: Endomondo plus a second
  ## source): same sport, starts within 10 min, durations within 20 %. The
  ## weaker copy (no HR, then fewer samples) gets `duplicate_of` in its
  ## `dq_flags`; rebuilt from scratch on every call.
  db.exec(sql"""UPDATE activities SET dq_flags = NULLIF(json_remove(dq_flags, '$.duplicate_of'), '{}')
                WHERE dq_flags LIKE '%duplicate_of%'""")
  var dup = initTable[string, string]()
  for r in db.rows(sql"""SELECT a.id, b.id,
        (a.avg_hr IS NOT NULL) * 1000000 + a.n_samples,
        (b.avg_hr IS NOT NULL) * 1000000 + b.n_samples
      FROM activities a JOIN activities b
        ON b.parent_type = a.parent_type AND b.id > a.id
       AND abs(julianday(a.start_gmt) - julianday(b.start_gmt)) * 86400 < 600
       AND abs(coalesce(a.duration, 0) - coalesce(b.duration, 0)) < 0.2 * max(a.duration, b.duration)"""):
    let (keep, drop) = (if parseInt(r[2]) >= parseInt(r[3]): (r[0], r[1]) else: (r[1], r[0]))
    if drop notin dup: dup[drop] = keep
  for drop, keep in dup:
    # follow chains so every copy points at the one that is kept
    var k = keep
    while k in dup: k = dup[k]
    db.exec(sql"""UPDATE activities SET dq_flags = json_set(coalesce(dq_flags, '{}'), '$.duplicate_of', CAST(? AS INTEGER))
                  WHERE id = ?""", parseInt(k), drop)

proc scanAndImport*(db: DbConn, activityDir, healthDir: string,
                    log: LogProc = (proc (m: string) {.gcsafe.} = stderr.writeLine m),
                    metricsDir = ""): ImportStats =
  ## `metricsDir` defaults to `<healthDir>/../metrics` (garmin sync-metrics).
  if db.getValue(sql"SELECT value FROM meta WHERE key = 'importer'") != ImporterVersion:
    log "importer version changed → re-importing everything"
    db.exec(sql"DELETE FROM files")
    db.exec(sql"INSERT OR REPLACE INTO meta(key, value) VALUES ('importer', ?)", ImporterVersion)
  scanDir(db, activityDir, "activity", result, log)
  scanDir(db, healthDir, "health", result, log)
  let mdir = if metricsDir.len > 0: metricsDir
             elif healthDir.len > 0: healthDir.absolutePath.parentDir / "metrics"
             else: ""
  scanDir(db, mdir, "metrics", result, log)
  # derived models depend on the whole history → rebuild after any change
  let empty = db.getValue(sql"SELECT COUNT(*) FROM run_model") == "0"
  if result.imported + result.removed > 0 or empty:
    let t0 = epochTime()
    db.computeRunModel()
    db.computeRoutes()
    db.markDuplicates()
    log &"run model rebuilt in {epochTime() - t0:.2f}s"

