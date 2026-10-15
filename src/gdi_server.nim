## gdi_server — HTTP API + static SPA over the SQLite database.
##
## std/asynchttpserver (same stack as the agent's `food_lookup.nim`), so the
## route handler can later be mounted under a prefix there. Responses are
## gzip-compressed when the client accepts it.

import std / [asynchttpserver, asyncdispatch, json, strutils, strformat, os,
              math, tables, times, base64, uri, sequtils, algorithm]
import db_connector / sqlite3
import zippy
import gdi_db, gdi_import

type
  ServerCfg* = object
    db*: DbConn
    activityDir*, healthDir*, staticDir*: string
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
  w_wind_speed, w_type, gear, n_samples, has_gps, decoupling, decoupling_steady, pace_cv"""

proc familyFilter(family: string, alias = "a"): (string, seq[string]) =
  if family.len == 0 or family == "all": ("1=1", @[])
  elif family.startsWith("type:"): (alias & ".type_key = ?", @[family[5 .. ^1]])
  else: (alias & ".parent_type = ?", @[family])

proc apiActivities(db: DbConn): JsonNode =
  db.queryTable("SELECT " & ActivityListCols.replace("id, name", "a.id, a.name") &
    ", m.delta AS exp_delta, m.expected_pace, m.ref_pace, m.coef FROM activities a LEFT JOIN run_model m ON m.activity_id = a.id ORDER BY a.start_local DESC")

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
        e.time, e.start_dist, e.avg_hr, e.elev_gain
      FROM best_efforts e JOIN activities a ON a.id = e.activity_id
      WHERE abs(e.distance - ?) < 0.01 AND {ff}
      ORDER BY e.time""", args)
  var args = @[$distance]
  args.add fargs
  let acts = db.queryTable(&"""SELECT a.id, a.name, a.type_key, a.start_local,
      a.distance, a.ascent_per_km, a.w_temp FROM activities a
      WHERE a.distance >= ? AND a.n_samples > 0 AND {ff}""", args)
  var rows = newJArray()
  for r in acts["rows"]:
    let id = r[0].getInt
    var st = initTable[string, seq[float]]()
    for (k, blob) in db.getStreams(id, ["t", "sumDistance", "directHeartRate", "directElevation"]):
      st[k] = decodeStream(blob).mapIt(float(it))
    if "t" notin st or "sumDistance" notin st: continue
    let be = bestEfforts(st["t"], st["sumDistance"], st.getOrDefault("directHeartRate"),
                         st.getOrDefault("directElevation"), [distance])
    if be.len == 0: continue
    let e = be[0]
    rows.add %*[id, r[1], r[2], r[3], r[4], r[5], r[6], e.time, e.startDist,
                (if e.avgHr.isNaN: newJNull() else: %e.avgHr), e.elevGain]
  var sorted = rows.getElems
  sorted.sort(proc (a, b: JsonNode): int = cmp(a[7].getFloat, b[7].getFloat))
  %*{"cols": ["id", "name", "type_key", "start_local", "total_distance",
              "ascent_per_km", "w_temp", "time", "start_dist", "avg_hr", "elev_gain"],
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
  db.queryTable(&"""SELECT s.activity_id, s.idx, s.length, s.time, s.avg_speed,
      s.avg_gap, s.avg_hr, s.avg_cadence, s.avg_power, s.ascent, s.descent, s.grade,
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
        let st = db.scanAndImport(cfg.activityDir, cfg.healthDir)
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
                                    proc (m: string) {.gcsafe.} = stderr.writeLine m)
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
