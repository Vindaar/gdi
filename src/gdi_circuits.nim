## gdi_circuits — shared stretches between runs, and circuits run several
## times within a run (laps of a loop).
##
## Every GPS track (running / walking / cycling) is resampled to a point every
## `Step` m. Two points "match" when they are within `Tol` m of each other and
## head the same way (±60°), so out-and-back stretches never match each other.
##
## Similar runs (`run_overlap`): for each pair of nearby tracks of one family,
## the metres of one that the other also covers. Pairs are pre-filtered by
## shared ~500 m cells.
##
## Circuits (`circuits`, `circuit_laps`): a run contains a loop when, for at
## least one loop length in a row, each point is revisited one loop length
## later (same place, same heading). Loops of all runs are clustered
## chronologically (length within 8 %, each covering ≥ 85 % of the other). The
## circuit's lap start is the point on it that yields the most complete laps
## across its runs. Then every run of the family passing there is cut into laps.
## A lap must be about one loop long (±10 %) and stay on the circuit (≥ 90 %
## of its points matching). Lap times are moving time, from the
## `sumMovingDuration` stream. Pace uses the circuit's own length, so laps
## compare on a fixed distance. Circuit ids are the first run's activity id
## × 100 + the loop's index in that run, so they stay stable as new runs
## arrive.

import std / [math, algorithm, tables, sets, json, strutils, strformat, times]
import db_connector / db_sqlite
import gdi_db

const
  Step = 10.0              ## m between resampled points
  Tol = 20.0               ## m: points this close (and same heading) match
  HeadTol = PI / 3         ## 60°
  MinLoop = 300.0          ## m: shortest circuit
  MaxJump = 200.0          ## m between samples: GPS jump / gap, not interpolated
  Coarse = 0.005           ## degrees: prefilter cells (~500 m)
  MinShared = 500.0        ## m: smaller overlaps aren't stored
  Families = ["running", "walking", "cycling"]

type
  Track = object
    id: int
    family, start: string
    lat, lon: seq[float]          ## resampled
    head: seq[float]              ## heading (rad), from ±2 points
    src: seq[float]               ## fractional source-sample index
    cells: HashSet[int64]         ## coarse cells
  Grid = object
    lat0, lon0, kx, ky: float     ## local projection of the grid's track
    xs, ys: seq[float]
    cells: Table[int64, seq[int32]]

proc cellKey(a, b: int): int64 = (int64(a) shl 32) xor (int64(b) and 0xffffffff'i64)

proc jfloat(x: float): JsonNode = (if x.isNaN: newJNull() else: %x)

proc readStream(db: DbConn, id: int, key: string): seq[float] =
  for (_, blob) in db.getStreams(id, [key]):
    for x in decodeStream(blob): result.add float(x)

proc resample(id: int, family, start: string, lat, lon: seq[float]): Track =
  result = Track(id: id, family: family, start: start)
  let kx0 = 111320.0 * cos(degToRad(if lat.len > 0: lat[0] else: 0.0))
  var prev = -1
  var acc = 0.0
  for i in 0 ..< min(lat.len, lon.len):
    if lat[i].isNaN or lon[i].isNaN or lat[i] == 0: continue
    if prev < 0:
      result.lat.add lat[i]; result.lon.add lon[i]; result.src.add float(i); prev = i; continue
    let dx = (lon[i] - lon[prev]) * kx0
    let dy = (lat[i] - lat[prev]) * 110540.0
    var d = sqrt(dx * dx + dy * dy)
    if d > MaxJump:
      # don't draw a line across a GPS jump / recording gap: restart here
      result.lat.add lat[i]; result.lon.add lon[i]; result.src.add float(i)
      prev = i; acc = 0; continue
    var f0 = 0.0                      # position along prev → i already used
    while acc + d * (1 - f0) >= Step:
      let need = Step - acc
      f0 += need / d
      result.lat.add lat[prev] + f0 * (lat[i] - lat[prev])
      result.lon.add lon[prev] + f0 * (lon[i] - lon[prev])
      result.src.add float(prev) + f0 * float(i - prev)
      acc = 0
    acc += d * (1 - f0)
    prev = i
  let n = result.lat.len
  result.head = newSeq[float](n)
  for k in 0 ..< n:
    let a = max(0, k - 2)
    let b = min(n - 1, k + 2)
    result.head[k] = arctan2((result.lat[b] - result.lat[a]) * 110540.0,
                             (result.lon[b] - result.lon[a]) * kx0)
  for k in 0 ..< n:
    result.cells.incl cellKey(int(floor(result.lat[k] / Coarse)), int(floor(result.lon[k] / Coarse)))

proc headOk(a, b: float): bool =
  var d = abs(a - b) mod (2 * PI)
  if d > PI: d = 2 * PI - d
  d < HeadTol

proc toGrid(t: Track): Grid =
  result.lat0 = t.lat[0]; result.lon0 = t.lon[0]
  result.kx = 111320.0 * cos(degToRad(t.lat[0])); result.ky = 110540.0
  result.xs = newSeq[float](t.lat.len); result.ys = newSeq[float](t.lat.len)
  for k in 0 ..< t.lat.len:
    let x = (t.lon[k] - result.lon0) * result.kx
    let y = (t.lat[k] - result.lat0) * result.ky
    result.xs[k] = x; result.ys[k] = y
    result.cells.mgetOrPut(cellKey(int(floor(x / Tol)), int(floor(y / Tol))), @[]).add int32(k)

iterator near(g: Grid, t: Track, lat, lon, head: float, tol = Tol): int =
  ## indices of `g`'s track points within `tol` of (lat, lon) heading the same way
  let x = (lon - g.lon0) * g.kx
  let y = (lat - g.lat0) * g.ky
  let cx = int(floor(x / Tol))
  let cy = int(floor(y / Tol))
  for dx in -1 .. 1:
    for dy in -1 .. 1:
      for k in g.cells.getOrDefault(cellKey(cx + dx, cy + dy)):
        let ex = g.xs[k] - x
        let ey = g.ys[k] - y
        if ex * ex + ey * ey <= tol * tol and headOk(t.head[k], head):
          yield int(k)

proc covers(g: Grid, gt: Track, b: Track, lo = 0, hi = -1): int =
  ## number of `b`'s points (in lo ..< hi) that the grid's track also covers
  let hi = (if hi < 0: b.lat.len else: hi)
  for k in lo ..< hi:
    for _ in g.near(gt, b.lat[k], b.lon[k], b.head[k]):
      inc result
      break

proc loadTracks(db: DbConn): seq[Track] =
  for r in db.rows(sql"""SELECT id, parent_type, start_local FROM activities
      WHERE has_gps = 1 AND parent_type IN ('running', 'walking', 'cycling')
        AND (dq_flags IS NULL OR dq_flags NOT LIKE '%duplicate_of%')
      ORDER BY start_local"""):
    let id = parseInt(r[0])
    let t = resample(id, r[1], r[2], db.readStream(id, "directLatitude"), db.readStream(id, "directLongitude"))
    if t.lat.len >= 10: result.add t

# ── loops within a run ─────────────────────────────────────────────────────

proc loopCandidates(t: Track, g: Grid): seq[(int, int)] =
  ## (first point, loop length in points) of each repeated loop in the run
  let n = t.lat.len
  let minPts = int(MinLoop / Step)
  var nxt = newSeq[int](n)
  for k in 0 ..< n:
    nxt[k] = -1
    for m in g.near(t, t.lat[k], t.lon[k], t.head[k], 15.0):
      if m >= k + minPts and (nxt[k] < 0 or m < nxt[k]): nxt[k] = m
  var k = 0
  while k < n:
    if nxt[k] < 0: inc k; continue
    # grow a group of points whose revisit distance stays about the same
    let d0 = nxt[k] - k
    var ds = @[d0]
    var last = k
    var j = k + 1
    while j < n and j - last <= 6:
      if nxt[j] >= 0:
        let d = nxt[j] - j
        var srt = ds; srt.sort()
        let med = srt[srt.len div 2]
        if abs(d - med) <= max(3, int(0.04 * float(med))):
          ds.add d; last = j
        elif j - last > 1:
          break
      inc j
    var srt = ds; srt.sort()
    let med = srt[srt.len div 2]
    if ds.len >= int(0.9 * float(med)) and last - k + 1 >= int(0.9 * float(med)):
      result.add (k, med)
      k = last + 1
    else:
      k = (if ds.len <= 1: j else: last + 1)

proc subTrack(t: Track, a, b: int): Track =
  result = Track(id: t.id, family: t.family, start: t.start,
                 lat: t.lat[a .. b], lon: t.lon[a .. b], head: t.head[a .. b], src: t.src[a .. b])

# ── lap statistics from the activity's streams ─────────────────────────────

proc at(xs: seq[float], f: float): float =
  ## linear interpolation at a fractional sample index (NaN-tolerant)
  if xs.len == 0: return NaN
  let i = clamp(int(floor(f)), 0, xs.high)
  let j = min(i + 1, xs.high)
  let w = f - float(i)
  if xs[i].isNaN: return xs[j]
  if xs[j].isNaN: return xs[i]
  xs[i] + w * (xs[j] - xs[i])

proc meanOver(xs, mv: seq[float], a, b: float): float =
  ## moving-time-weighted mean of `xs` between fractional indices a and b
  if xs.len == 0 or mv.len != xs.len: return NaN
  var s, w = 0.0
  for i in max(0, int(floor(a))) ..< min(xs.high, int(ceil(b))):
    let dw = mv[i + 1] - mv[i]
    if not xs[i].isNaN and not dw.isNaN and dw > 0:
      s += xs[i] * dw; w += dw
  if w > 0: s / w else: NaN

# ── main ───────────────────────────────────────────────────────────────────

proc computeCircuits*(db: DbConn, log: proc (m: string) {.gcsafe.} = nil) =
  let t0 = epochTime()
  let tracks = db.loadTracks()
  var grids = newSeq[Grid](tracks.len)
  for i, t in tracks: grids[i] = t.toGrid
  # coarse cell → tracks, per family
  var byCell = initTable[(string, int64), seq[int]]()
  for i, t in tracks:
    for c in t.cells: byCell.mgetOrPut((t.family, c), @[]).add i

  # ── similar runs (incremental: only pairs with a new / re-imported track) ──
  var done = initHashSet[int]()
  for r in db.rows(sql"SELECT activity_id FROM overlap_done"): done.incl parseInt(r[0])
  var isNew = newSeq[bool](tracks.len)
  var present = initHashSet[int]()
  db.exec(sql"BEGIN")
  for i, t in tracks:
    present.incl t.id
    isNew[i] = t.id notin done
    if isNew[i]: db.exec(sql"DELETE FROM run_overlap WHERE a = ? OR b = ?", t.id, t.id)
  for id in done:
    if id notin present:               # deleted, or no longer a track
      db.exec(sql"DELETE FROM run_overlap WHERE a = ? OR b = ?", id, id)
      db.exec(sql"DELETE FROM overlap_done WHERE activity_id = ?", id)
  var nPairs = 0
  for a in 0 ..< tracks.len:
    var cand = initCountTable[int]()
    for c in tracks[a].cells:
      for b in byCell.getOrDefault((tracks[a].family, c)):
        if b != a and (isNew[a] or isNew[b]): cand.inc b
    for b, nShared in cand:
      if nShared < 2: continue
      let m = float(grids[a].covers(tracks[a], tracks[b])) * Step
      if m >= MinShared:
        db.exec(sql"INSERT OR REPLACE INTO run_overlap(a, b, shared) VALUES (?, ?, ?)", tracks[a].id, tracks[b].id, m)
        inc nPairs
  for i, t in tracks:
    if isNew[i]: db.exec(sql"INSERT OR IGNORE INTO overlap_done(activity_id) VALUES (?)", t.id)
  db.exec(sql"COMMIT")
  let t1 = epochTime()

  # ── circuits: loops within runs, clustered across runs ──
  type Circuit = object
    id: int
    family: string
    geom: Track
    grid: Grid
    members: seq[int]               ## track indices with this loop
  var circuits: seq[Circuit]
  for i, t in tracks:
    for li, (k0, len) in loopCandidates(t, grids[i]):
      if k0 + len >= t.lat.len: continue
      let loop = t.subTrack(k0, k0 + len - 1)
      let lg = loop.toGrid
      var joined = false
      for c in circuits.mitems:
        if c.family != t.family: continue
        let lc = c.geom.lat.len
        if abs(lc - loop.lat.len) > int(0.08 * float(max(lc, loop.lat.len))): continue
        if c.grid.covers(c.geom, loop) < int(0.85 * float(loop.lat.len)): continue
        if lg.covers(loop, c.geom) < int(0.85 * float(lc)): continue
        if i notin c.members: c.members.add i
        joined = true
        break
      if not joined:
        circuits.add Circuit(id: t.id * 100 + li, family: t.family, geom: loop, grid: lg, members: @[i])

  # lap start + laps of every run passing it
  proc passes(t: Track, lat, lon, head: float): seq[int] =
    ## indices where `t` passes the point (closest point of each visit)
    var hits: seq[int]
    let kx = 111320.0 * cos(degToRad(lat))
    for k in 0 ..< t.lat.len:
      let dx = (t.lon[k] - lon) * kx
      let dy = (t.lat[k] - lat) * 110540.0
      if dx * dx + dy * dy <= Tol * Tol and headOk(t.head[k], head): hits.add k
    var groups: seq[seq[int]]
    for k in hits:
      if groups.len == 0 or k - groups[^1][^1] > 10: groups.add @[k]
      else: groups[^1].add k
    for gr in groups:
      var best = gr[0]
      var bd = Inf
      for k in gr:
        let dx = (t.lon[k] - lon) * kx
        let dy = (t.lat[k] - lat) * 110540.0
        if dx * dx + dy * dy < bd: bd = dx * dx + dy * dy; best = k
      result.add best

  proc lapsOf(c: Circuit, t: Track, anchor: int): seq[(int, int)] =
    let L = c.geom.lat.len
    let ps = passes(t, c.geom.lat[anchor], c.geom.lon[anchor], c.geom.head[anchor])
    for j in 0 ..< ps.len - 1:
      let (a, b) = (ps[j], ps[j + 1])
      if abs((b - a) - L) > int(0.10 * float(L)): continue
      if c.grid.covers(c.geom, t, a, b) < int(0.90 * float(b - a)): continue
      result.add (a, b)

  db.exec(sql"BEGIN")
  db.exec(sql"DELETE FROM circuits")
  db.exec(sql"DELETE FROM circuit_laps")
  var nLaps = 0
  for c in circuits:
    let L = c.geom.lat.len
    # lap start: the circuit point giving the most complete laps over its runs
    var bestA = 0
    var bestN = -1
    for a in countup(0, L - 1, 3):
      var nl = 0
      for i in c.members: nl += lapsOf(c, tracks[i], a).len
      if nl > bestN: bestN = nl; bestA = a
    if bestN < 1: continue
    # every run of the family near the lap start
    let ac = cellKey(int(floor(c.geom.lat[bestA] / Coarse)), int(floor(c.geom.lon[bestA] / Coarse)))
    var runsN = 0
    var first, last = ""
    for i in byCell.getOrDefault((c.family, ac)):
      let laps = lapsOf(c, tracks[i], bestA)
      if laps.len == 0: continue
      inc runsN
      let t = tracks[i]
      if first.len == 0 or t.start < first: first = t.start
      if t.start > last: last = t.start
      let tt = db.readStream(t.id, "t")
      let mv = db.readStream(t.id, "sumMovingDuration")
      let dist = db.readStream(t.id, "sumDistance")
      let hr = db.readStream(t.id, "directHeartRate")
      let gap = db.readStream(t.id, "directGradeAdjustedSpeed")
      for li, (a, b) in laps:
        let (fa, fb) = (t.src[a], t.src[b])
        let moving = mv.at(fb) - mv.at(fa)
        let elapsed = tt.at(fb) - tt.at(fa)
        let tm = (if moving.isNaN or moving <= 0: elapsed else: moving)
        db.insertRow("circuit_laps", @[
          ("circuit_id", %c.id), ("activity_id", %t.id), ("lap", %(li + 1)),
          ("t_start", jfloat(tt.at(fa))), ("moving", jfloat(tm)), ("elapsed", jfloat(elapsed)),
          ("watch_dist", jfloat(dist.at(fb) - dist.at(fa))),
          ("avg_hr", jfloat(meanOver(hr, mv, fa, fb))),
          ("avg_gap", jfloat(meanOver(gap, mv, fa, fb)))])
        inc nLaps
    # geometry from the lap start, every 2nd point
    var pts = newJArray()
    for k in 0 ..< L:
      if k mod 2 == 0:
        let kk = (bestA + k) mod L
        pts.add %*[round(c.geom.lat[kk], 6), round(c.geom.lon[kk], 6)]
    pts.add %*[round(c.geom.lat[bestA], 6), round(c.geom.lon[bestA], 6)]
    db.insertRow("circuits", @[
      ("id", %c.id), ("family", %c.family), ("length", %(float(L) * Step)),
      ("lat", %c.geom.lat[bestA]), ("lon", %c.geom.lon[bestA]),
      ("n_runs", %runsN), ("first_date", %first), ("last_date", %last), ("pts", %($pts))])
  db.exec(sql"COMMIT")
  if log != nil:
    log &"circuits: {tracks.len} tracks, {nPairs} new overlapping pairs ({t1 - t0:.1f}s), " &
        &"{circuits.len} loops → {nLaps} laps ({epochTime() - t1:.1f}s)"
