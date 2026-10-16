## gdi_server — HTTP API + static SPA over the SQLite database.
##
## std/asynchttpserver (same stack as the agent's `food_lookup.nim`), so the
## route handler can later be mounted under a prefix there. Responses are
## gzip-compressed when the client accepts it.

import std / [asynchttpserver, asyncdispatch, json, strutils, strformat, os,
              math, tables, times, base64, uri, sequtils, algorithm]
import db_connector / sqlite3
import zippy
import gdi_db, gdi_import, gdi_notes, gdi_export

type
  ServerCfg* = object
    db*: DbConn
    activityDir*, healthDir*, staticDir*, notesFile*: string
    user*, password*: string        ## basic auth; empty user = disabled
    watchInterval*: int             ## seconds; 0 = no auto-import

# ── typed query → JSON table ────────────────────────────────────────────────

proc queryTable*(db: DbConn, q: string, args: varargs[string]): JsonNode =
  ## {"cols": [...], "rows": [[...], ...]} with SQLite's native value types.
  var st: PStmt
  if prepare_v2(db, q.cstring, q.len.cint, st, nil) != SQLITE_OK:
    dbError(db)
  defer: discard finalize(st)
  for i, a in args:
    discard bind_text(st, cint(i + 1), a.cstring, a.len.cint, SQLITE_TRANSIENT)
  let nc = column_count(st)
  var cols = newJArray()
  for c in 0 ..< nc: cols.add %($column_name(st, c))
  var rows = newJArray()
  while step(st) == SQLITE_ROW:
    var r = newJArray()
    for c in 0 ..< nc:
      case column_type(st, c)
      of SQLITE_INTEGER: r.add %column_int64(st, c)
      of SQLITE_FLOAT: r.add %column_double(st, c)
      of SQLITE_NULL: r.add newJNull()
      else: r.add %($column_text(st, c))
    rows.add r
  %*{"cols": cols, "rows": rows}

proc firstRowObj(t: JsonNode): JsonNode =
  if t["rows"].len == 0: return newJNull()
  result = newJObject()
  for i, c in t["cols"].getElems:
    result[c.getStr] = t["rows"][0][i]

# ── settings / zones ────────────────────────────────────────────────────────

proc defaultSettings*(): JsonNode =
  ## HR zones: Garmin's current config (HR reserve, floors from
  ## /biometric-service/heartRateZones). Pace zones: fractions of lactate
  ## threshold speed (Garmin: lactateThresholdSpeed × 10 m/s).
  %*{
    "hrZones": [116, 130, 144, 158, 172],      # zone floors, bpm
    "maxHr": 186, "restingHr": 46, "lthr": 169,
    "thresholdSpeed": 3.611,                   # m/s (≈ 4:37 /km)
    "paceZones": [0.0, 0.78, 0.88, 0.95, 1.02],# zone floors, × threshold speed
    "paceZoneNames": ["Recovery", "Easy", "Tempo", "Threshold", "VO2max+"],
    "hrZoneNames": ["Warm-up", "Easy", "Aerobic", "Threshold", "Maximum"],
  }

proc settings*(db: DbConn): JsonNode =
  result = defaultSettings()
  let stored = db.getSetting("ui", newJObject())
  for k, v in stored: result[k] = v

proc zoneCase(col: string, floors: seq[float]): string =
  ## SQL CASE mapping `col` to zone 0 (below zone 1) … floors.len.
  result = "CASE"
  for i in countdown(floors.high, 0):
    result.add &" WHEN {col} >= {floors[i]} THEN {i + 1}"
  result.add " ELSE 0 END"

proc speedFloors(s: JsonNode): seq[float] =
  let ts = s["thresholdSpeed"].getFloat
  for f in s["paceZones"]: result.add f.getFloat * ts / SpeedBucket

proc hrFloors(s: JsonNode): seq[float] =
  for f in s["hrZones"]: result.add f.getFloat

# ── handlers ────────────────────────────────────────────────────────────────

const ActivityListCols = """id, name, type_key, parent_type, location, start_local,
  distance, duration, moving_duration, elev_gain, elev_loss, ascent_per_km,
  avg_speed, avg_moving_speed, avg_gap_speed, gap_source, max_speed, avg_hr, max_hr,
  avg_cadence, avg_power, norm_power, calories, aerobic_te, anaerobic_te,
  training_load, te_label, avg_temp, w_temp, w_apparent_temp, w_humidity,
  w_wind_speed, w_type, gear, n_samples, has_gps, decoupling, decoupling_steady, pace_cv, dq_flags, rpe, feel,
  elapsed_duration, min_hr, max_cadence, max_power, avg_stride, steps, min_elev, max_elev,
  w_dew_point, w_wind_gust, avg_gct, avg_vo, avg_vr, avg_gcb, avg_resp, max_resp,
  stamina_begin, stamina_end, stamina_min, bb_delta, impact_load, recovery_hr,
  step_speed_loss, intensity_min, perf_cond_first, perf_cond_last"""

proc familyFilter(family: string, alias = "a"): (string, seq[string]) =
  if family.len == 0 or family == "all": ("1=1", @[])
  elif family.startsWith("type:"): (alias & ".type_key = ?", @[family[5 .. ^1]])
  else: (alias & ".parent_type = ?", @[family])

proc apiActivities(db: DbConn): JsonNode =
  db.queryTable("SELECT " & ActivityListCols.replace("id, name", "a.id, a.name") &
    ", m.delta AS exp_delta, m.expected_pace, m.ref_pace, m.coef, n.tags, n.note," &
    " (SELECT max(drop60) FROM hr_recovery r WHERE r.activity_id = a.id) AS hrr60," &
    " (SELECT max(drop120) FROM hr_recovery r WHERE r.activity_id = a.id) AS hrr120" &
    " FROM activities a LEFT JOIN run_model m ON m.activity_id = a.id LEFT JOIN activity_notes n ON n.activity_id = a.id ORDER BY a.start_local DESC")

proc apiModelWindow(db: DbConn, id: string): JsonNode =
  ## Segments the run's expected-pace model was fitted on (for the scatter):
  ## same filters as gdi_models, window per run_model.window_days.
  let m = db.queryTable("SELECT window_days FROM run_model WHERE activity_id = ?", id).firstRowObj
  if m.kind == JNull: return newJNull()
  let days = m["window_days"].getFloat
  db.queryTable(&"""SELECT s.activity_id, s.avg_hr, s.avg_gap, s.time, a.type_key,
      (s.activity_id = ?) AS mine
    FROM segments s JOIN activities a ON a.id = s.activity_id,
         activities me
    WHERE me.id = ? AND a.parent_type = 'running' AND s.idx >= 1
      AND s.avg_hr BETWEEN 100 AND 200 AND s.avg_gap > 1.5 AND s.avg_gap < 7
      AND abs(COALESCE(s.grade, 0)) <= 10
      AND ((julianday(a.start_local) < julianday(me.start_local)
            AND julianday(a.start_local) >= julianday(me.start_local) - {days})
           OR a.id = me.id)""", id, id)

proc apiNotes(db: DbConn, id: string): JsonNode =
  ## the diary entry of an activity (tags, display text, other activities in it)
  result = db.queryTable("""SELECT n.tags, n.note, n.date, n.shared_with FROM activity_notes n
      WHERE n.activity_id = ?""", id).firstRowObj
  if result.kind == JObject and result{"shared_with"}.getStr.len > 0:
    var other = newJArray()
    for x in parseJson(result["shared_with"].getStr):
      let r = db.getRow(sql"SELECT name, start_local FROM activities WHERE id = ?", x.getInt)
      other.add %*{"id": x, "name": r[0], "start_local": r[1]}
    result["shared"] = other

proc apiActivity(db: DbConn, id: string): JsonNode =
  let a = db.queryTable("SELECT * FROM activities WHERE id = ?", id).firstRowObj
  if a.kind == JNull: return newJNull()
  let meta = a["meta_json"]
  a.delete("meta_json")
  %*{
    "activity": a,
    "meta": (if meta.kind == JString: parseJson(meta.getStr) else: newJNull()),
    "laps": db.queryTable("SELECT * FROM laps WHERE activity_id = ? ORDER BY idx", id),
    "efforts": db.queryTable("""SELECT e.distance, e.time, e.start_t, e.start_dist,
        e.avg_hr, e.elev_gain,
        (SELECT COUNT(*) + 1 FROM best_efforts b JOIN activities x ON x.id = b.activity_id
          WHERE b.distance = e.distance AND x.parent_type = a.parent_type
            AND b.time < e.time) AS rank
      FROM best_efforts e JOIN activities a ON a.id = e.activity_id
      WHERE e.activity_id = ? ORDER BY e.distance""", id),
    "hrHist": db.queryTable("SELECT bpm, secs FROM hr_hist WHERE activity_id = ? ORDER BY bpm", id),
    "speedHist": db.queryTable("SELECT bucket, secs, gap_secs FROM speed_hist WHERE activity_id = ? ORDER BY bucket", id),
    "segments": db.queryTable("SELECT * FROM segments WHERE activity_id = ? ORDER BY idx", id),
    "hrRecovery": db.queryTable("SELECT * FROM hr_recovery WHERE activity_id = ? ORDER BY t_end", id),
    "notes": db.apiNotes(id),
    "settings": db.settings(),
    "model": db.queryTable("SELECT * FROM run_model WHERE activity_id = ?", id).firstRowObj,
    "modelNoise": db.getValue(sql"SELECT value FROM meta WHERE key = 'run_model_noise'"),
    "route": db.queryTable("""SELECT r.route_id, (SELECT COUNT(*) FROM routes x WHERE x.route_id = r.route_id) AS n,
        (SELECT COUNT(*) + 1 FROM routes x JOIN activities y ON y.id = x.activity_id
          WHERE x.route_id = r.route_id AND y.moving_duration < me.moving_duration) AS rank
      FROM routes r JOIN activities me ON me.id = r.activity_id WHERE r.activity_id = ?""", id).firstRowObj,
  }

proc apiStreams(db: DbConn, id: int): JsonNode =
  result = newJObject()
  for (k, blob) in db.getStreams(id):
    let xs = decodeStream(blob)
    let digits = if k in ["directLatitude", "directLongitude"]: 6 else: 2
    var arr = newJArray()
    for x in xs:
      if x.isNaN: arr.add newJNull()
      else: arr.add %round(float(x), digits)
    result[k] = arr

proc apiEfforts(db: DbConn, distance: float, family: string): JsonNode =
  ## Best effort per activity for `distance`. Precomputed distances come from
  ## `best_efforts`; any other distance is computed from the streams.
  let (ff, fargs) = familyFilter(family)
  var precomputed = false
  for d in BestEffortDistances:
    if abs(d - distance) < 0.01: precomputed = true
  if precomputed:
    var args = @[$distance]
    args.add fargs
    return db.queryTable(&"""SELECT a.id, a.name, a.type_key, a.start_local,
        a.distance AS total_distance, a.ascent_per_km, a.w_temp,
        e.time, e.start_dist, e.avg_hr, e.elev_gain, a.dq_flags
      FROM best_efforts e JOIN activities a ON a.id = e.activity_id
      WHERE abs(e.distance - ?) < 0.01 AND {ff}
      ORDER BY e.time""", args)
  var args = @[$distance]
  args.add fargs
  let acts = db.queryTable(&"""SELECT a.id, a.name, a.type_key, a.start_local,
      a.distance, a.ascent_per_km, a.w_temp, a.parent_type, a.dq_flags FROM activities a
      WHERE a.distance >= ? AND a.n_samples > 0 AND {ff}
        AND (a.dq_flags IS NULL OR a.dq_flags NOT LIKE '%distance_mismatch%')""", args)
  var rows = newJArray()
  for r in acts["rows"]:
    let id = r[0].getInt
    var st = initTable[string, seq[float]]()
    for (k, blob) in db.getStreams(id, ["t", "sumDistance", "directHeartRate", "directElevation",
                                        "directSpeed", "directDoubleCadence"]):
      st[k] = decodeStream(blob).mapIt(float(it))
    if "t" notin st or "sumDistance" notin st: continue
    # same glitch cleaning as the precomputed distances (gdi_import)
    let family = r[7].getStr
    let speed = st.getOrDefault("directSpeed")
    let bad = strideGlitches(family, speed, st.getOrDefault("directDoubleCadence"))
    let clean = cleanDistance(st["t"], st["sumDistance"], speed, bad, family)
    if not clean.ok: continue
    let be = bestEfforts(st["t"], clean.cum, st.getOrDefault("directHeartRate"),
                         st.getOrDefault("directElevation"), [distance])
    if be.len == 0: continue
    let e = be[0]
    rows.add %*[id, r[1], r[2], r[3], r[4], r[5], r[6], e.time, e.startDist,
                (if e.avgHr.isNaN: newJNull() else: %e.avgHr), e.elevGain, r[8]]
  var sorted = rows.getElems
  sorted.sort(proc (a, b: JsonNode): int = cmp(a[7].getFloat, b[7].getFloat))
  %*{"cols": ["id", "name", "type_key", "start_local", "total_distance",
              "ascent_per_km", "w_temp", "time", "start_dist", "avg_hr", "elev_gain", "dq_flags"],
     "rows": sorted}

proc apiMmp(db: DbConn, metric, family, fromD, toD: string): JsonNode =
  ## Best value per duration (with the activity it came from) in a date range.
  let (ff, fargs) = familyFilter(family)
  var args = @[metric]
  args.add fargs
  args.add [(if fromD.len > 0: fromD else: "0000"), (if toD.len > 0: toD & "T99" else: "9999")]
  db.queryTable(&"""SELECT m.duration, m.value, m.start_t, a.id, a.name, a.start_local, a.type_key
    FROM mmp m JOIN activities a ON a.id = m.activity_id
    WHERE m.metric = ? AND {ff} AND a.start_local >= ? AND a.start_local <= ?
      AND m.value = (SELECT MAX(m2.value) FROM mmp m2 JOIN activities a2 ON a2.id = m2.activity_id
                     WHERE m2.metric = m.metric AND m2.duration = m.duration
                       AND {ff.replace("a.", "a2.")} AND a2.start_local >= ? AND a2.start_local <= ?)
    GROUP BY m.duration ORDER BY m.duration""", args & args[1 .. ^1])

proc apiRoutes(db: DbConn): JsonNode =
  ## Routes run at least twice, with the reference track sketch.
  db.queryTable("""SELECT r.route_id, COUNT(*) AS n, ref.parent_type AS family,
      ref.name AS ref_name, ref.location, ref.distance AS ref_distance, ref.elev_gain AS ref_gain,
      MIN(a.start_local) AS first, MAX(a.start_local) AS last,
      MIN(a.moving_duration) AS best_time,
      (SELECT x.activity_id FROM routes x JOIN activities y ON y.id = x.activity_id
        WHERE x.route_id = r.route_id ORDER BY y.moving_duration LIMIT 1) AS best_id,
      sig.pts
    FROM routes r JOIN activities a ON a.id = r.activity_id
      JOIN activities ref ON ref.id = r.route_id
      LEFT JOIN route_sig sig ON sig.activity_id = r.route_id
    GROUP BY r.route_id HAVING COUNT(*) >= 2 ORDER BY n DESC""")

proc apiRoute(db: DbConn, id: string): JsonNode =
  let info = db.queryTable("""SELECT a.id AS route_id, a.parent_type AS family, a.name AS ref_name,
      a.location, a.distance AS ref_distance, sig.pts
    FROM activities a LEFT JOIN route_sig sig ON sig.activity_id = a.id WHERE a.id = ?""", id).firstRowObj
  if info.kind == JNull: return newJNull()
  %*{
    "info": info,
    "runs": db.queryTable("SELECT " & ActivityListCols.replace("id, name", "a.id, a.name") &
      """, m.delta AS exp_delta, r.match_m FROM routes r JOIN activities a ON a.id = r.activity_id
      LEFT JOIN run_model m ON m.activity_id = a.id WHERE r.route_id = ? ORDER BY a.start_local""", id),
  }

proc apiSegments(db: DbConn, family: string): JsonNode =
  let (ff, fargs) = familyFilter(family)
  db.queryTable(&"""SELECT s.activity_id, s.idx, s.start_dist, s.start_t, s.length, s.time, s.avg_speed,
      s.avg_gap, s.avg_hr, s.avg_cadence, s.avg_power, s.ascent, s.descent, s.grade,
      s.max_hr, s.avg_stride, s.avg_gct, s.avg_vo, s.avg_vr, s.avg_gcb, s.avg_resp,
      s.avg_temp, s.stamina, s.perf_cond,
      a.start_local, a.type_key, a.name, a.distance AS total_distance,
      a.ascent_per_km, a.w_temp, a.w_humidity, a.w_wind_speed
    FROM segments s JOIN activities a ON a.id = s.activity_id
    WHERE {ff} ORDER BY a.start_local""", fargs)

proc apiZoneSummary(db: DbConn, family, group, kind: string): JsonNode =
  ## Moving seconds per (period, zone). `kind` = hr | pace | gap.
  let s = db.settings()
  let fmt = case group
            of "day": "%Y-%m-%d"
            of "month": "%Y-%m"
            of "year": "%Y"
            else: "%Y-W%W"
  let (ff, fargs) = familyFilter(family)
  let q = case kind
    of "pace", "gap":
      let col = if kind == "gap": "h.gap_secs" else: "h.secs"
      &"""SELECT strftime('{fmt}', a.start_local) AS period,
            {zoneCase("h.bucket", speedFloors(s))} AS zone, SUM({col}) AS secs
          FROM speed_hist h JOIN activities a ON a.id = h.activity_id
          WHERE {ff} GROUP BY period, zone ORDER BY period"""
    else:
      &"""SELECT strftime('{fmt}', a.start_local) AS period,
            {zoneCase("h.bpm", hrFloors(s))} AS zone, SUM(h.secs) AS secs
          FROM hr_hist h JOIN activities a ON a.id = h.activity_id
          WHERE {ff} GROUP BY period, zone ORDER BY period"""
  db.queryTable(q, fargs)

proc apiSampleHist(db: DbConn, body: JsonNode): JsonNode =
  ## Time-weighted sample histograms summed over groups of activities.
  ## body: {"kind": "hr"|"pace"|"gap", "groups": {"name": [ids…]}}
  ## → {"name": [[bucket, secs], …]}; bucket = bpm (hr) or speed / 0.05 m/s.
  let kind = body{"kind"}.getStr("hr")
  result = newJObject()
  for name, ids in body{"groups"}:
    var idList: seq[string]
    for x in ids: idList.add $x.getBiggestInt   # ints only → safe to inline
    if idList.len == 0:
      result[name] = newJArray(); continue
    let q = case kind
      of "pace": "SELECT bucket, SUM(secs) FROM speed_hist WHERE activity_id IN (" & idList.join(",") & ") GROUP BY bucket"
      of "gap": "SELECT bucket, SUM(gap_secs) FROM speed_hist WHERE activity_id IN (" & idList.join(",") & ") GROUP BY bucket"
      else: "SELECT bpm, SUM(secs) FROM hr_hist WHERE activity_id IN (" & idList.join(",") & ") GROUP BY bpm"
    result[name] = db.queryTable(q)["rows"]

proc median(xs: seq[float]): float =
  var v = xs.filterIt(not it.isNaN)
  if v.len == 0: return NaN
  v.sort()
  if v.len mod 2 == 1: v[v.len div 2] else: (v[v.len div 2 - 1] + v[v.len div 2]) / 2

proc apiBlock(db: DbConn, family, fromD, toD: string): JsonNode =
  ## Everything the block comparison shows for one date range (inclusive):
  ## volume, zone mix, efficiency, bests, health. Duplicate uploads are left
  ## out so volume isn't counted twice.
  let s = db.settings()
  let (ff, fargs) = familyFilter(family)
  let toEnd = toD & "T99"                        # include the whole last day
  let actWhere = &"{ff} AND a.start_local >= ? AND a.start_local <= ? AND (a.dq_flags IS NULL OR a.dq_flags NOT LIKE '%duplicate_of%')"
  var args = fargs & @[fromD, toEnd]
  proc jn(x: float): JsonNode = (if x.isNaN: newJNull() else: %x)
  result = %*{"from": fromD, "to": toD}
  # volume
  let v = db.queryTable(&"""SELECT COUNT(*), SUM(distance), SUM(moving_duration), SUM(elev_gain),
      SUM(training_load), MAX(distance), MAX(moving_duration)
      FROM activities a WHERE {actWhere}""", args)["rows"][0]
  result["volume"] = %*{"n": v[0], "distance": v[1], "moving": v[2], "ascent": v[3],
                        "load": v[4], "longest": v[5], "longestTime": v[6]}
  # weekly series (Monday-based weeks; the client aligns them by index)
  result["weekly"] = db.queryTable(&"""SELECT date(a.start_local, '-' || ((strftime('%w', a.start_local) + 6) % 7) || ' days') AS week,
      COUNT(*) AS n, SUM(distance) AS distance, SUM(moving_duration) AS moving, SUM(training_load) AS load
      FROM activities a WHERE {actWhere} GROUP BY week ORDER BY week""", args)
  # zone mix (moving seconds per zone)
  var hrZ = newSeq[float](6)
  for r in db.rows(sql(&"""SELECT {zoneCase("h.bpm", hrFloors(s))}, SUM(h.secs)
      FROM hr_hist h JOIN activities a ON a.id = h.activity_id WHERE {actWhere} GROUP BY 1"""), args):
    hrZ[parseInt(r[0])] = parseFloat(r[1])
  let useGap = family == "running"
  var pZ = newSeq[float](6)
  for r in db.rows(sql(&"""SELECT {zoneCase("h.bucket", speedFloors(s))}, SUM({(if useGap: "h.gap_secs" else: "h.secs")})
      FROM speed_hist h JOIN activities a ON a.id = h.activity_id WHERE {actWhere} GROUP BY 1"""), args):
    pZ[parseInt(r[0])] = parseFloat(r[1])
  result["hrZones"] = %hrZ
  result["paceZones"] = %pZ
  result["paceZonesGap"] = %useGap
  # efficiency
  var deltas, refs, decs, hrs, gaps: seq[float]
  for r in db.rows(sql(&"""SELECT m.delta, m.ref_pace FROM run_model m JOIN activities a ON a.id = m.activity_id
      WHERE {actWhere}"""), args):
    deltas.add parseFloat(r[0]); refs.add parseFloat(r[1])
  for r in db.rows(sql(&"""SELECT decoupling, avg_hr, avg_gap_speed, decoupling_steady FROM activities a
      WHERE {actWhere}"""), args):
    if r[0].len > 0 and r[3] == "1": decs.add parseFloat(r[0])
    if r[1].len > 0: hrs.add parseFloat(r[1])
    if r[2].len > 0: gaps.add parseFloat(r[2])
  result["efficiency"] = %*{"nModel": deltas.len, "expDelta": jn median(deltas),
    "refPace": jn median(refs), "nSteady": decs.len, "decoupling": jn median(decs),
    "avgHr": jn median(hrs), "avgGap": jn median(gaps)}
  # bests inside the block
  var bests = newJObject()
  for d in [1000.0, 5000.0, 10000.0, 21097.5]:
    let b = db.queryTable(&"""SELECT e.time, a.id FROM best_efforts e JOIN activities a ON a.id = e.activity_id
        WHERE abs(e.distance - {d}) < 0.01 AND {actWhere} ORDER BY e.time LIMIT 1""", args)["rows"]
    bests[$int(d)] = (if b.len > 0: b[0] else: newJNull())
  result["bests"] = bests
  var mm = newJObject()
  for dur in [60, 300, 1200, 3600]:
    let b = db.queryTable(&"""SELECT m.value, a.id FROM mmp m JOIN activities a ON a.id = m.activity_id
        WHERE m.metric = 'speed' AND m.duration = {dur} AND {actWhere} ORDER BY m.value DESC LIMIT 1""", args)["rows"]
    mm[$dur] = (if b.len > 0: b[0] else: newJNull())
  result["mmp"] = mm
  # health over the same days
  let hd = db.queryTable("""SELECT AVG(resting_hr), AVG(sleep_secs), AVG(sleep_score), AVG(avg_stress),
      AVG(steps), AVG(weight), COUNT(*) FROM health_days WHERE date >= ? AND date <= ?""", fromD, toD)["rows"][0]
  let gm = db.queryTable("""SELECT metric, AVG(value) FROM garmin_metrics
      WHERE metric IN ('hrv_night', 'readiness', 'vo2max') AND date >= ? AND date <= ? GROUP BY metric""", fromD, toD)["rows"]
  var health = %*{"restingHr": hd[0], "sleep": hd[1], "sleepScore": hd[2], "stress": hd[3],
                  "steps": hd[4], "weight": hd[5], "days": hd[6]}
  for r in gm: health[r[0].getStr] = r[1]
  result["health"] = health

proc apiHrRecovery(db: DbConn): JsonNode =
  ## Every detected recovery (gdi_import.hrRecovery) with its activity.
  db.queryTable("""SELECT r.activity_id, a.start_local, a.name, r.t_end, r.effort_secs,
      r.effort_speed, r.post_speed, r.peak_hr, r.drop60, r.drop120, a.w_temp
    FROM hr_recovery r JOIN activities a ON a.id = r.activity_id
    WHERE a.dq_flags IS NULL OR (a.dq_flags NOT LIKE '%duplicate_of%' AND a.dq_flags NOT LIKE '%hr_cadence_lock%')
    ORDER BY a.start_local, r.t_end""")

proc apiGear(db: DbConn): JsonNode =
  ## Gear records (latest snapshot per item) and every linked activity with
  ## the numbers the gear page aggregates.
  var gear = newJObject()
  for r in db.rows(sql"""SELECT g.uuid, g.json FROM activity_gear g JOIN activities a ON a.id = g.activity_id
      ORDER BY a.start_local"""):
    gear[r[0]] = parseJson(r[1])          # later activities overwrite → latest snapshot
  %*{"gear": gear,
     "uses": db.queryTable("""SELECT g.uuid, g.name, a.id, a.start_local, a.parent_type, a.type_key,
        a.distance, a.moving_duration, a.elev_gain, a.ascent_per_km, a.avg_hr, a.avg_gap_speed,
        a.avg_moving_speed, a.avg_cadence, a.avg_stride, m.delta, a.decoupling, a.decoupling_steady
      FROM activity_gear g JOIN activities a ON a.id = g.activity_id
      LEFT JOIN run_model m ON m.activity_id = a.id
      WHERE a.dq_flags IS NULL OR a.dq_flags NOT LIKE '%duplicate_of%'
      ORDER BY a.start_local""")}

proc apiGarminMetrics(db: DbConn, names: string): JsonNode =
  ## {metric: [[date, value, text], …]} for the requested (or all) metrics.
  result = newJObject()
  var q = "SELECT metric, date, value, text FROM garmin_metrics"
  var args: seq[string]
  if names.len > 0:
    var qs: seq[string]
    for n in names.split(','):
      qs.add "?"; args.add n.strip
    q &= " WHERE metric IN (" & qs.join(",") & ")"
  q &= " ORDER BY metric, date"
  for r in db.queryTable(q, args)["rows"]:
    let m = r[0].getStr
    if not result.hasKey(m): result[m] = newJArray()
    result[m].add %*[r[1], r[2], r[3]]

proc apiHealth(db: DbConn): JsonNode =
  db.queryTable("""SELECT date, steps, distance, total_kcal, active_kcal,
      resting_hr, min_hr, max_hr, avg_stress, max_stress, bb_high, bb_low,
      bb_charged, bb_drained, bb_wake, sleep_secs, deep_secs, light_secs,
      rem_secs, awake_secs, sleep_score, sleep_avg_hr, sleep_avg_stress,
      sleep_resp, waking_resp, intensity_mod, intensity_vig, floors_up,
      weight, body_fat, bed_time, wake_time FROM health_days ORDER BY date""")

proc apiHealthDay(db: DbConn, date: string): JsonNode =
  let v = db.getValue(sql"SELECT json FROM health_days WHERE date = ?", date)
  if v.len == 0: newJNull() else: parseJson(v)

proc apiStatus(db: DbConn): JsonNode =
  %*{
    "activities": db.getValue(sql"SELECT COUNT(*) FROM activities").parseInt,
    "withStreams": db.getValue(sql"SELECT COUNT(*) FROM activities WHERE n_samples > 0").parseInt,
    "healthDays": db.getValue(sql"SELECT COUNT(*) FROM health_days").parseInt,
    "lastImport": db.getValue(sql"SELECT MAX(imported_at) FROM files"),
    "importErrors": db.queryTable("SELECT path, error FROM files WHERE error IS NOT NULL"),
  }

# ── HTTP plumbing ───────────────────────────────────────────────────────────

proc mimeFor(path: string): string =
  case path.splitFile.ext.toLowerAscii
  of ".html": "text/html; charset=utf-8"
  of ".js", ".mjs": "text/javascript; charset=utf-8"
  of ".css": "text/css; charset=utf-8"
  of ".json": "application/json"
  of ".svg": "image/svg+xml"
  of ".png": "image/png"
  else: "application/octet-stream"

proc send(req: Request, code: HttpCode, body, ctype: string,
          extra: seq[(string, string)] = @[]): Future[void] =
  var headers = newHttpHeaders({"Content-Type": ctype})
  for (k, v) in extra: headers[k] = v
  var data = body
  if body.len > 1024 and "gzip" in req.headers.getOrDefault("Accept-Encoding"):
    data = compress(body, BestSpeed, dfGzip)
    headers["Content-Encoding"] = "gzip"
  req.respond(code, data, headers)

proc sendJson(req: Request, j: JsonNode, code = Http200): Future[void] =
  req.send(code, $j, "application/json; charset=utf-8",
           @[("Cache-Control", "no-store")])

proc authorized(cfg: ServerCfg, req: Request): bool =
  if cfg.user.len == 0: return true
  let h = req.headers.getOrDefault("Authorization")
  if not h.startsWith("Basic "): return false
  try: decode(h[6 .. ^1]) == cfg.user & ":" & cfg.password
  except ValueError: false

proc queryParams(req: Request): Table[string, string] =
  for k, v in decodeQuery(req.url.query): result[k] = v

proc handle*(cfg: ServerCfg, req: Request, prefix = ""): Future[void] {.async, gcsafe.} =
  ## Route a request. `prefix` is stripped from the path so the app can be
  ## mounted below another server's root.
  if not cfg.authorized(req):
    await req.respond(Http401, "auth required", newHttpHeaders(
      {"WWW-Authenticate": "Basic realm=\"garmin\""}))
    return
  var path = req.url.path
  if prefix.len > 0 and path.startsWith(prefix): path = path[prefix.len .. ^1]
  if path.len == 0: path = "/"
  let qp = req.queryParams
  let db = cfg.db
  try:
    let parts = path.strip(chars = {'/'}).split('/')
    if parts[0] == "api":
      let r = parts[1 .. ^1]
      if r == @["status"]: await req.sendJson(db.apiStatus)
      elif r == @["activities"]: await req.sendJson(db.apiActivities)
      elif r.len == 2 and r[0] == "activity":
        let a = db.apiActivity(r[1])
        if a.kind == JNull: await req.sendJson(%*{"error": "not found"}, Http404)
        else: await req.sendJson(a)
      elif r.len == 3 and r[0] == "activity" and r[2] == "model-window":
        await req.sendJson(db.apiModelWindow(r[1]))
      elif r.len == 3 and r[0] == "activity" and r[2] == "tags" and req.reqMethod == HttpPost:
        let b = parseJson(req.body)
        var tags: seq[string]
        for t in b{"tags"}.getElems: tags.add t.getStr
        # pick up edits made in the file meanwhile; refuse to overwrite them
        discard db.importNotes(cfg.notesFile)
        let cur = db.getValue(sql"SELECT tags FROM activity_notes WHERE activity_id = ?", r[1])
        let curTags = (if cur.len > 0: parseJson(cur) else: newJArray())
        let base = b{"base"}
        if base != nil and base != curTags:
          await req.sendJson(%*{"error": "tags changed in the diary meanwhile", "current": curTags}, Http409)
        else:
          db.saveTags(cfg.notesFile, parseInt(r[1]), tags)
          await req.sendJson(db.apiNotes(r[1]))
      elif r.len == 3 and r[0] == "activity" and r[2] == "append" and req.reqMethod == HttpPost:
        db.appendNote(cfg.notesFile, parseInt(r[1]), parseJson(req.body){"text"}.getStr)
        await req.sendJson(db.apiNotes(r[1]))
      elif r == @["diary"]:
        let d = qp.getOrDefault("date", "")
        await req.sendJson(%*{
          "activities": db.queryTable("""SELECT n.activity_id, a.name, a.type_key, a.start_local, n.tags, n.note
              FROM activity_notes n JOIN activities a ON a.id = n.activity_id
              WHERE substr(a.start_local, 1, 10) = ? OR n.date = ? ORDER BY a.start_local""", d, d),
          "day": db.queryTable("SELECT tags, note FROM day_notes WHERE date = ?", d)})
      elif r == @["export"]:
        var ids: seq[int]
        for x in qp.getOrDefault("ids", "").split(','):
          if x.strip.len > 0: ids.add parseInt(x.strip)
        if ids.len == 0:
          await req.sendJson(%*{"error": "no ids"}, Http400)
        else:
          let f = db.exportActivities(cfg.activityDir, ids, qp.getOrDefault("level", "summary"),
                                      qp.getOrDefault("format", "json"))
          await req.send(Http200, f.body, f.mime,
                         @[("Content-Disposition", "attachment; filename=\"" & f.name & "\""),
                           ("Cache-Control", "no-store")])
      elif r == @["tags"]:
        var arr = newJArray()
        var ct = db.allTags()
        ct.sort()
        for t, n in ct: arr.add %*[t, n]
        await req.sendJson(%*{"tags": arr, "file": cfg.notesFile})
      elif r.len == 3 and r[0] == "activity" and r[2] == "streams":
        await req.sendJson(db.apiStreams(parseInt(r[1])))
      elif r == @["efforts"]:
        await req.sendJson(db.apiEfforts(parseFloat(qp.getOrDefault("distance", "5000")),
                                         qp.getOrDefault("family", "running")))
      elif r == @["mmp"]:
        await req.sendJson(db.apiMmp(qp.getOrDefault("metric", "speed"), qp.getOrDefault("family", "running"),
                                     qp.getOrDefault("from", ""), qp.getOrDefault("to", "")))
      elif r == @["routes"]: await req.sendJson(db.apiRoutes)
      elif r.len == 2 and r[0] == "route":
        let rt = db.apiRoute(r[1])
        if rt.kind == JNull: await req.sendJson(%*{"error": "not found"}, Http404)
        else: await req.sendJson(rt)
      elif r == @["segments"]:
        await req.sendJson(db.apiSegments(qp.getOrDefault("family", "running")))
      elif r == @["zones"]:
        await req.sendJson(db.apiZoneSummary(qp.getOrDefault("family", "running"),
                                             qp.getOrDefault("group", "week"),
                                             qp.getOrDefault("kind", "hr")))
      elif r == @["hist"] and req.reqMethod == HttpPost:
        await req.sendJson(db.apiSampleHist(parseJson(req.body)))
      elif r == @["hr-recovery"]: await req.sendJson(db.apiHrRecovery)
      elif r == @["gear"]: await req.sendJson(db.apiGear)
      elif r == @["block"]:
        await req.sendJson(db.apiBlock(qp.getOrDefault("family", "running"),
                                       qp.getOrDefault("from", ""), qp.getOrDefault("to", "")))
      elif r == @["garmin-metrics"]:
        await req.sendJson(db.apiGarminMetrics(qp.getOrDefault("names", "")))
      elif r == @["health"]: await req.sendJson(db.apiHealth)
      elif r.len == 2 and r[0] == "health": await req.sendJson(db.apiHealthDay(r[1]))
      elif r == @["settings"]:
        if req.reqMethod == HttpPost:
          var stored = db.getSetting("ui", newJObject())
          for k, v in parseJson(req.body): stored[k] = v
          db.setSetting("ui", stored)
        await req.sendJson(db.settings)
      elif r == @["reimport"] and req.reqMethod == HttpPost:
        let st = db.scanAndImport(cfg.activityDir, cfg.healthDir, notesFile = cfg.notesFile)
        await req.sendJson(%*{"imported": st.imported, "failed": st.failed,
                               "removed": st.removed})
      else:
        await req.sendJson(%*{"error": "unknown endpoint"}, Http404)
      return
    # static files; anything unknown → index.html (client-side routing)
    var file = cfg.staticDir / path.strip(chars = {'/'})
    if path == "/" or not fileExists(file) or ".." in path:
      file = cfg.staticDir / "index.html"
    await req.send(Http200, readFile(file), mimeFor(file),
                   @[("Cache-Control", "no-cache")])
  except CatchableError as e:
    stderr.writeLine "error on ", path, ": ", e.msg
    await req.sendJson(%*{"error": e.msg}, Http500)

proc watchLoop(cfg: ServerCfg) {.async.} =
  ## Re-import changed raw files periodically. `scanAndImport` only stats
  ## files unless something changed, so this is cheap when idle.
  while true:
    await sleepAsync(cfg.watchInterval * 1000)
    try:
      let st = cfg.db.scanAndImport(cfg.activityDir, cfg.healthDir,
                                    (proc (m: string) {.gcsafe.} = stderr.writeLine m),
                                    notesFile = cfg.notesFile)
      if st.imported + st.removed + st.failed > 0:
        stderr.writeLine &"[{now().format(\"HH:mm:ss\")}] auto-import: " &
                         &"{st.imported} imported, {st.removed} removed, {st.failed} failed"
    except CatchableError as e:
      stderr.writeLine "auto-import failed: ", e.msg

proc serve*(cfg: ServerCfg, port: int, address = "127.0.0.1") =
  let server = newAsyncHttpServer(maxBody = 1 shl 20)
  if cfg.watchInterval > 0:
    asyncCheck watchLoop(cfg)
  stderr.writeLine &"serving on http://{address}:{port}/"
  proc cb(req: Request) {.async, gcsafe.} =
    await handle(cfg, req)
  waitFor server.serve(Port(port), cb, address)
