## gdi_db — SQLite storage for the Garmin data interface.
##
## Scalar data lives in ordinary columns (sortable / filterable in SQL).
## Per-sample time series are stored as one zippy-compressed float32 BLOB per
## activity and stream (`streams` table); NaN encodes a missing sample.
## Per-activity histograms (`hr_hist`, `speed_hist`) let zone percentages be
## computed for *any* zone definition without touching the streams.

import std / [os, strutils, json, math]
import db_connector / [db_sqlite, sqlite3]
import zippy

export db_sqlite

const SchemaVersion* = 1

const Schema = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'activity' | 'health'
  mtime       INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  error       TEXT
);
CREATE TABLE IF NOT EXISTS activities (
  id               INTEGER PRIMARY KEY,
  name             TEXT,
  type_key         TEXT,
  parent_type      TEXT,
  location         TEXT,
  start_local      TEXT,              -- ISO, local time
  start_gmt        TEXT,
  start_lat        REAL,
  start_lon        REAL,
  distance         REAL,              -- m
  duration         REAL,              -- s
  moving_duration  REAL,
  elapsed_duration REAL,
  elev_gain        REAL,
  elev_loss        REAL,
  min_elev         REAL,
  max_elev         REAL,
  ascent_per_km    REAL,              -- elev_gain / km
  avg_speed        REAL,              -- m/s
  avg_moving_speed REAL,
  max_speed        REAL,
  avg_gap_speed    REAL,              -- grade-adjusted, from streams
  gap_source       TEXT,              -- 'garmin' | 'estimated' | NULL
  decoupling       REAL,              -- % efficiency loss 2nd vs 1st half (see gdi_import)
  decoupling_steady INTEGER,          -- 1 if the run was steady enough to interpret it
  pace_cv          REAL,              -- variability of 1-min GAP (or power) averages
  dq_flags         TEXT,              -- JSON object of data-quality issues (see gdi_import), NULL if clean
  rpe              REAL,              -- perceived effort 1–10 (watch prompt after the activity)
  feel             REAL,              -- "how did you feel" 0 (very weak) … 100 (very strong)
  avg_hr           REAL,
  max_hr           REAL,
  min_hr           REAL,
  avg_cadence      REAL,
  max_cadence      REAL,
  avg_power        REAL,
  max_power        REAL,
  norm_power       REAL,
  avg_stride       REAL,
  calories         REAL,
  aerobic_te       REAL,
  anaerobic_te     REAL,
  training_load    REAL,
  te_label         TEXT,
  avg_temp         REAL,              -- device sensor
  steps            INTEGER,
  avg_gct          REAL,              -- running dynamics (Garmin summary)
  avg_vo           REAL,
  avg_vr           REAL,
  avg_gcb          REAL,
  avg_resp         REAL,              -- breaths/min
  max_resp         REAL,
  stamina_begin    REAL,              -- potential stamina, %
  stamina_end      REAL,
  stamina_min      REAL,              -- lowest available stamina, %
  bb_delta         REAL,              -- Body Battery change
  impact_load      REAL,
  recovery_hr      REAL,              -- Garmin's recovery heart rate
  step_speed_loss  REAL,              -- %
  intensity_min    REAL,              -- moderate + 2 × vigorous minutes
  perf_cond_first  REAL,              -- performance condition: first / last value
  perf_cond_last   REAL,
  w_temp           REAL,              -- weather at start
  w_apparent_temp  REAL,
  w_dew_point      REAL,
  w_humidity       REAL,
  w_wind_speed     REAL,
  w_wind_gust      REAL,
  w_wind_dir       TEXT,
  w_type           TEXT,
  w_source         TEXT,              -- 'garmin' | 'open-meteo' (gdi_weather) | NULL
  gear             TEXT,
  n_samples        INTEGER NOT NULL DEFAULT 0,
  has_gps          INTEGER NOT NULL DEFAULT 0,
  meta_json        TEXT               -- activity/laps/weather/splits/zones (no streams)
);
CREATE INDEX IF NOT EXISTS act_start ON activities(start_local);
CREATE INDEX IF NOT EXISTS act_type  ON activities(type_key);
CREATE TABLE IF NOT EXISTS streams (
  activity_id INTEGER NOT NULL,
  key         TEXT NOT NULL,          -- e.g. 't', 'directHeartRate', 'sumDistance'
  data        BLOB NOT NULL,          -- zippy(float32 LE[])
  PRIMARY KEY (activity_id, key)
);
CREATE TABLE IF NOT EXISTS laps (
  activity_id INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  start_gmt   TEXT,
  distance    REAL,
  duration    REAL,
  moving_duration REAL,
  avg_speed   REAL,
  avg_hr      REAL,
  max_hr      REAL,
  avg_cadence REAL,
  avg_power   REAL,
  elev_gain   REAL,
  elev_loss   REAL,
  PRIMARY KEY (activity_id, idx)
);
CREATE TABLE IF NOT EXISTS best_efforts (
  activity_id INTEGER NOT NULL,
  distance    REAL NOT NULL,          -- m (target distance)
  time        REAL NOT NULL,          -- s, elapsed
  start_t     REAL NOT NULL,          -- s from activity start
  start_dist  REAL NOT NULL,          -- m from activity start
  avg_hr      REAL,
  elev_gain   REAL,
  PRIMARY KEY (activity_id, distance)
);
CREATE INDEX IF NOT EXISTS be_dist ON best_efforts(distance, time);
CREATE TABLE IF NOT EXISTS hr_hist (       -- moving seconds per bpm
  activity_id INTEGER NOT NULL,
  bpm         INTEGER NOT NULL,
  secs        REAL NOT NULL,
  PRIMARY KEY (activity_id, bpm)
);
CREATE TABLE IF NOT EXISTS speed_hist (    -- moving seconds per 0.05 m/s bucket
  activity_id INTEGER NOT NULL,
  bucket      INTEGER NOT NULL,       -- speed = bucket * 0.05
  secs        REAL NOT NULL,
  gap_secs    REAL NOT NULL DEFAULT 0,-- same, using grade-adjusted speed
  PRIMARY KEY (activity_id, bucket)
);
CREATE TABLE IF NOT EXISTS segments (     -- consecutive 1 km chunks
  activity_id INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  start_dist  REAL NOT NULL,
  start_t     REAL NOT NULL,
  length      REAL NOT NULL,          -- m (≥ 1000, sample granularity)
  time        REAL NOT NULL,          -- moving s
  avg_speed   REAL,
  avg_gap     REAL,
  avg_hr      REAL,
  avg_cadence REAL,
  avg_power   REAL,
  ascent      REAL,
  descent     REAL,
  grade       REAL,                   -- net %, end vs start elevation
  max_hr      REAL,
  avg_stride  REAL,                   -- cm
  avg_gct     REAL,                   -- ground contact time, ms
  avg_vo      REAL,                   -- vertical oscillation, cm
  avg_vr      REAL,                   -- vertical ratio, %
  avg_gcb     REAL,                   -- ground contact balance (left), %
  avg_resp    REAL,                   -- respiration, breaths/min
  avg_temp    REAL,                   -- device temperature sensor, °C
  stamina     REAL,                   -- available stamina at the segment end, %
  perf_cond   REAL,                   -- mean performance condition
  PRIMARY KEY (activity_id, idx)
);
CREATE TABLE IF NOT EXISTS mmp (          -- mean-maximal values by duration
  activity_id INTEGER NOT NULL,
  metric      TEXT NOT NULL,          -- 'speed' | 'gap' (m/s) | 'power' (W)
  duration    INTEGER NOT NULL,       -- s
  value       REAL NOT NULL,
  start_t     REAL,                   -- s from activity start
  PRIMARY KEY (activity_id, metric, duration)
);
CREATE INDEX IF NOT EXISTS mmp_md ON mmp(metric, duration, value);
CREATE TABLE IF NOT EXISTS weather_fill (  -- Open-Meteo lookups (gdi_weather), kept across re-imports
  activity_id INTEGER PRIMARY KEY,
  fetched_at  INTEGER NOT NULL,       -- unix s
  ok          INTEGER NOT NULL,       -- 0 = failed / no data (retried after a week)
  json        TEXT                    -- the day's hourly values (UTC)
);
CREATE TABLE IF NOT EXISTS activity_notes ( -- diary entry per activity (gdi_notes), survives activity re-imports
  activity_id INTEGER PRIMARY KEY,
  date        TEXT,                   -- the entry's heading date
  tags        TEXT NOT NULL,          -- JSON array (the entry's heading tags)
  note        TEXT,                   -- display text (no drawer / pasted stats)
  shared_with TEXT                    -- JSON array: other activities in the same entry
);
CREATE TABLE IF NOT EXISTS day_notes (     -- diary entries without an activity
  date        TEXT,
  tags        TEXT NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS day_notes_date ON day_notes(date);
CREATE TABLE IF NOT EXISTS activity_gear ( -- every gear item linked to an activity
  activity_id INTEGER NOT NULL,
  uuid        TEXT NOT NULL,
  name        TEXT,
  gear_type   TEXT,                   -- SHOES, BIKE, …
  json        TEXT,                   -- Garmin's gear record as of the activity's sync
  PRIMARY KEY (activity_id, uuid)
);
CREATE TABLE IF NOT EXISTS hr_recovery (  -- HR drop after easing off a hard stretch (gdi_import.hrRecovery)
  activity_id INTEGER NOT NULL,
  t_end       REAL NOT NULL,          -- s from start: where the effort ends
  effort_secs REAL,                   -- how long the hard stretch lasted
  effort_speed REAL,                  -- mean (GAP) speed over the last 60 s of it, m/s
  post_speed  REAL,                   -- mean speed during the 60 s after the peak
  peak_hr     REAL,
  t_peak      REAL,
  drop60      REAL,                   -- peak − HR 60 s after the peak
  drop120     REAL,                   -- NULL if the next effort started within 120 s
  PRIMARY KEY (activity_id, t_end)
);
CREATE TABLE IF NOT EXISTS run_model (    -- expected-pace model, see gdi_models
  activity_id   INTEGER PRIMARY KEY,
  delta         REAL,                 -- s/km, actual − expected (negative = faster)
  n_seg         INTEGER,
  window_n      INTEGER,              -- segments the model was fitted on
  window_days   REAL,
  actual_pace   REAL,                 -- s/km (time-weighted over scored segments)
  expected_pace REAL,
  ref_pace      REAL,                 -- model pace at 140 bpm, road, flat, 30 min in
  window_temp   REAL,                 -- mean weather temperature of the window
  coef          TEXT                  -- JSON [a, b·hr, c·hours, d·trail, e·updn/100m]
);
CREATE TABLE IF NOT EXISTS health_days (
  date              TEXT PRIMARY KEY,
  steps             INTEGER,
  distance          REAL,
  total_kcal        REAL,
  active_kcal       REAL,
  resting_hr        REAL,
  min_hr            REAL,
  max_hr            REAL,
  avg_stress        REAL,
  max_stress        REAL,
  bb_high           REAL,
  bb_low            REAL,
  bb_charged        REAL,
  bb_drained        REAL,
  bb_wake           REAL,
  sleep_secs        REAL,
  deep_secs         REAL,
  light_secs        REAL,
  rem_secs          REAL,
  awake_secs        REAL,
  sleep_score       REAL,
  sleep_avg_hr      REAL,
  sleep_avg_stress  REAL,
  sleep_resp        REAL,
  waking_resp       REAL,
  intensity_mod     REAL,
  intensity_vig     REAL,
  floors_up         REAL,
  weight            REAL,             -- kg
  body_fat          REAL,
  bed_time          REAL,             -- local hour asleep, 24+ after midnight
  wake_time         REAL,             -- local hour awake
  json              TEXT              -- full raw day (intraday series)
);
CREATE TABLE IF NOT EXISTS garmin_metrics (  -- Garmin's computed metrics (gdi_metrics)
  date   TEXT NOT NULL,
  metric TEXT NOT NULL,               -- vo2max, hrv_night, race_5k, readiness, …
  value  REAL,
  text   TEXT,                        -- status / level where Garmin gives one
  PRIMARY KEY (metric, date)
);
CREATE TABLE IF NOT EXISTS route_sig (       -- GPS track resampled to 64 points
  activity_id INTEGER PRIMARY KEY,
  family      TEXT,
  gps_length  REAL,                   -- m, along the GPS track
  pts         TEXT                    -- JSON [[lat, lon], …]
);
CREATE TABLE IF NOT EXISTS routes (          -- repeated-route clusters (gdi_models)
  activity_id INTEGER PRIMARY KEY,
  route_id    INTEGER NOT NULL,       -- = activity id of the route's first run (stable)
  match_m     REAL                    -- mean distance to the route's reference track
);
CREATE INDEX IF NOT EXISTS routes_route ON routes(route_id);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT                          -- JSON
);
"""

proc openDb*(path: string): DbConn =
  createDir(path.parentDir)
  result = open(path, "", "", "")
  result.exec(sql"PRAGMA journal_mode = WAL")
  result.exec(sql"PRAGMA synchronous = NORMAL")
  result.exec(sql"PRAGMA foreign_keys = OFF")
  for stmt in Schema.split(";"):
    if stmt.strip.len > 0:
      result.exec(sql(stmt))
  # migrations for databases created by older versions
  var cols: seq[string]
  for r in result.rows(sql"PRAGMA table_info(activities)"): cols.add r[1]
  for (col, typ) in [("gap_source", "TEXT"), ("decoupling", "REAL"),
                     ("decoupling_steady", "INTEGER"), ("pace_cv", "REAL"),
                     ("dq_flags", "TEXT"), ("rpe", "REAL"), ("feel", "REAL"),
                     ("avg_gct", "REAL"), ("avg_vo", "REAL"), ("avg_vr", "REAL"),
                     ("avg_gcb", "REAL"), ("avg_resp", "REAL"), ("max_resp", "REAL"),
                     ("stamina_begin", "REAL"), ("stamina_end", "REAL"), ("stamina_min", "REAL"),
                     ("bb_delta", "REAL"), ("impact_load", "REAL"), ("recovery_hr", "REAL"),
                     ("step_speed_loss", "REAL"), ("intensity_min", "REAL"),
                     ("perf_cond_first", "REAL"), ("perf_cond_last", "REAL"),
                     ("w_source", "TEXT")]:
    if col notin cols:
      result.exec(sql("ALTER TABLE activities ADD COLUMN " & col & " " & typ))
  # segments are derived (filled by the importer): recreate on layout change
  var scols: seq[string]
  for r in result.rows(sql"PRAGMA table_info(segments)"): scols.add r[1]
  if "perf_cond" notin scols:
    result.exec(sql"DROP TABLE IF EXISTS segments")
    for stmt in Schema.split(';'):
      if "TABLE IF NOT EXISTS segments" in stmt: result.exec(sql(stmt))
  # notes tables are derived from the diary file: recreate on layout change
  var ncols: seq[string]
  for r in result.rows(sql"PRAGMA table_info(activity_notes)"): ncols.add r[1]
  if "shared_with" notin ncols:
    result.exec(sql"DROP TABLE IF EXISTS activity_notes")
    result.exec(sql"DELETE FROM files WHERE kind = 'notes'")
    for stmt in Schema.split(';'):
      if "activity_notes" in stmt or "day_notes" in stmt:
        if stmt.strip.len > 0: result.exec(sql(stmt))
  var hcols: seq[string]
  for r in result.rows(sql"PRAGMA table_info(health_days)"): hcols.add r[1]
  for col in ["bed_time", "wake_time"]:
    if col notin hcols:
      result.exec(sql("ALTER TABLE health_days ADD COLUMN " & col & " REAL"))
  result.exec(sql"INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?)",
              $SchemaVersion)

# ── float32 stream BLOBs ────────────────────────────────────────────────────

proc encodeStream*(xs: openArray[float]): string =
  ## float32 little-endian, zippy-compressed. NaN = missing.
  var raw = newString(xs.len * 4)
  for i, x in xs:
    var f = float32(x)
    copyMem(raw[i * 4].addr, f.addr, 4)
  compress(raw, BestSpeed, dfZlib)

proc decodeStream*(blob: string): seq[float32] =
  let raw = uncompress(blob, dfZlib)
  result = newSeq[float32](raw.len div 4)
  if result.len > 0:
    copyMem(result[0].addr, raw[0].unsafeAddr, result.len * 4)

proc rawFloat32*(blob: string): string =
  ## Uncompressed float32 bytes, for sending straight to the browser.
  uncompress(blob, dfZlib)

proc putStream*(db: DbConn, activityId: int, key: string, xs: openArray[float]) =
  let ps = db.prepare("INSERT OR REPLACE INTO streams(activity_id, key, data) VALUES (?, ?, ?)")
  defer: discard finalize(ps.PStmt)
  let blob = encodeStream(xs)
  ps.bindParam(1, activityId)
  ps.bindParam(2, key)
  ps.bindParam(3, blob.toOpenArrayByte(0, blob.high))
  if step(ps.PStmt) != SQLITE_DONE:
    dbError(db)

proc getBlobs*(db: DbConn, query: string, args: varargs[string]): seq[(string, string)] =
  ## Rows of (text col 0, blob col 1). `db_sqlite`'s row API goes through
  ## C strings, which truncates binary data at the first NUL.
  var st: PStmt
  if prepare_v2(db, query.cstring, query.len.cint, st, nil) != SQLITE_OK:
    dbError(db)
  defer: discard finalize(st)
  for i, a in args:
    discard bind_text(st, cint(i + 1), a.cstring, a.len.cint, SQLITE_TRANSIENT)
  while step(st) == SQLITE_ROW:
    let k = $column_text(st, 0)
    let n = column_bytes(st, 1)
    var data = newString(n)
    if n > 0:
      copyMem(data[0].addr, column_blob(st, 1), n)
    result.add (k, data)

proc getStreams*(db: DbConn, activityId: int, keys: openArray[string] = []): seq[(string, string)] =
  ## (key, compressed blob) for an activity, optionally restricted to `keys`.
  if keys.len == 0:
    db.getBlobs("SELECT key, data FROM streams WHERE activity_id = ?", $activityId)
  else:
    var qs: seq[string]
    for k in keys: qs.add "?"
    var args = @[$activityId]
    args.add @keys
    db.getBlobs("SELECT key, data FROM streams WHERE activity_id = ? AND key IN (" &
                qs.join(",") & ")", args)

# ── settings ────────────────────────────────────────────────────────────────

proc getSetting*(db: DbConn, key: string, default: JsonNode = newJNull()): JsonNode =
  let v = db.getValue(sql"SELECT value FROM settings WHERE key = ?", key)
  if v.len == 0: default else: parseJson(v)

proc setSetting*(db: DbConn, key: string, value: JsonNode) =
  db.exec(sql"INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", key, $value)

# ── generic typed insert ────────────────────────────────────────────────────

type Cols* = seq[(string, JsonNode)]

proc insertRow*(db: DbConn, table: string, cols: Cols) =
  ## INSERT OR REPLACE with types taken from the JSON values; JNull and NaN
  ## floats become SQL NULL (so they sort / aggregate correctly).
  var names, qs: seq[string]
  for (k, _) in cols:
    names.add k
    qs.add "?"
  let ps = db.prepare("INSERT OR REPLACE INTO " & table & "(" & names.join(",") &
                      ") VALUES (" & qs.join(",") & ")")
  defer: discard finalize(ps.PStmt)
  for i, (_, v) in cols:
    let idx = i + 1
    if v.isNil: ps.bindNull(idx); continue
    case v.kind
    of JNull: ps.bindNull(idx)
    of JInt: ps.bindParam(idx, v.getBiggestInt.int64)
    of JFloat:
      let f = v.getFloat
      if f.isNaN or f.classify in {fcInf, fcNegInf}: ps.bindNull(idx)
      else: ps.bindParam(idx, f)
    of JBool: ps.bindParam(idx, int(v.getBool))
    of JString: ps.bindParam(idx, v.getStr)
    of JObject, JArray: ps.bindParam(idx, $v)
  if step(ps.PStmt) notin [SQLITE_DONE, SQLITE_ROW]:
    dbError(db)
